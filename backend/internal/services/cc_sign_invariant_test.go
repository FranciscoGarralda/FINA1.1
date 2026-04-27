package services

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Tests de invariante de signo CC para patas pendientes (H-013..H-016).
//
// Causa raíz histórica: la "tabla maestra" del sprint Compra fijó los sides al
// revés respecto de la convención del sistema documentada en
// `cc_service.go:37` y `cc_repo.go:56`:
//
//	"negative = client owes more, positive = debt reduction"
//
// Esto hizo que, para clientes con CC y pata pendiente, el balance del cliente
// se moviera en sentido OPUESTO al esperado (saldo a favor cuando debía ser
// deuda y viceversa). El smoke V2 lo dejó a la vista: vendiendo USD 100 a un
// cliente CC con OUT pendiente, el balance USD del cliente bajaba 100 cuando
// debía subir 100 (la casa todavía no entregó la divisa, así que la casa le
// debe al cliente → saldo a favor del cliente sube).
//
// Estos tests son tres capas de defensa puras (sin DB):
//
//  1. Convención del helper `signedCCAmount`: ccSideIn produce signo positivo,
//     ccSideOut produce signo negativo. Si alguien invierte la convención del
//     helper, el bug se replicaría silenciosamente en todos los servicios.
//
//  2. Mapeo semántico operación→pata→side esperado: declara, en función de
//     "quién debe a quién" (negocio), el side correcto y verifica que el helper
//     produce el signo coherente.
//
//  3. Invariante estructural: lee `venta_service.go` y `compra_service.go` y
//     verifica que las 4 invocaciones de `applyCCImpactTx` para patas
//     pendientes usan el side correcto. Si una futura modificación invierte el
//     side, el test rompe antes de llegar a producción. La nota textual de
//     cada llamada es el ancla.

// 1) Convención del helper.

func TestCCSignedAmount_ConvencionSistema(t *testing.T) {
	t.Parallel()
	cases := []struct {
		side string
		want string
		desc string
	}{
		{ccSideIn, "100", "ccSideIn debe ser positivo (debt reduction / saldo a favor)"},
		{ccSideOut, "-100", "ccSideOut debe ser negativo (client owes more / deuda)"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.side, func(t *testing.T) {
			got, err := signedCCAmount("100", c.side)
			if err != nil {
				t.Fatalf("signedCCAmount(100, %q) error: %v", c.side, err)
			}
			if got != c.want {
				t.Fatalf("%s: got %q want %q", c.desc, got, c.want)
			}
		})
	}
}

// 2) Mapeo semántico operación→pata→side.
//
// Para cada caso "cliente CC + pata pendiente", declara explícitamente quién
// debe a quién y cuál es el side esperado según la convención del sistema.
// Sirve como tabla canónica: si en el futuro se cuestiona "¿qué side va
// acá?", esta tabla manda y los servicios deben respetarla.

type ccSemanticCase struct {
	name              string
	hallazgo          string
	debeAlCliente     bool   // true = la casa le debe al cliente; false = el cliente le debe a la casa
	expectedSide      string // ccSideIn o ccSideOut
	expectedSignFirst byte   // '+' (sin prefijo) o '-'
}

func ccSemanticCases() []ccSemanticCase {
	return []ccSemanticCase{
		{
			name:              "Venta OUT pendiente — casa debe entregar divisa al cliente",
			hallazgo:          "H-013",
			debeAlCliente:     true,
			expectedSide:      ccSideIn,
			expectedSignFirst: '+',
		},
		{
			name:              "Venta IN pendiente — cliente debe pagarle a la casa",
			hallazgo:          "H-014",
			debeAlCliente:     false,
			expectedSide:      ccSideOut,
			expectedSignFirst: '-',
		},
		{
			name:              "Compra IN pendiente — cliente debe entregar la divisa que vendió",
			hallazgo:          "H-015",
			debeAlCliente:     false,
			expectedSide:      ccSideOut,
			expectedSignFirst: '-',
		},
		{
			name:              "Compra OUT pendiente — casa debe pagarle la cotización al cliente",
			hallazgo:          "H-016",
			debeAlCliente:     true,
			expectedSide:      ccSideIn,
			expectedSignFirst: '+',
		},
	}
}

func TestCCSemanticTable_MatchesConvention(t *testing.T) {
	t.Parallel()
	for _, c := range ccSemanticCases() {
		c := c
		t.Run(c.hallazgo+"_"+c.name, func(t *testing.T) {
			signed, err := signedCCAmount("100", c.expectedSide)
			if err != nil {
				t.Fatalf("signedCCAmount: %v", err)
			}
			gotSign := byte('+')
			if strings.HasPrefix(signed, "-") {
				gotSign = '-'
			}
			if gotSign != c.expectedSignFirst {
				t.Fatalf("%s (%s): side=%s produjo %q, signo esperado %q (%s)",
					c.hallazgo, c.name, c.expectedSide, signed, string(c.expectedSignFirst),
					func() string {
						if c.debeAlCliente {
							return "la casa debe al cliente → saldo a favor del cliente sube"
						}
						return "el cliente debe a la casa → deuda del cliente sube"
					}())
			}
		})
	}
}

// 3) Invariante estructural sobre los archivos de servicio.
//
// Verifica que cada una de las 4 patas CC pendientes en venta_service.go y
// compra_service.go invoca `applyCCImpactTx` con el side esperado por la
// convención. La nota textual de cada llamada es el ancla — coincide con el
// audit trail que terminó en `cc_entries.note`.
//
// Si alguien cambia el side sin pasar por la conversación de "tabla maestra"
// (por ejemplo, copiando una versión vieja del código), este test rompe.

type structuralExpectation struct {
	hallazgo     string
	relPath      string
	noteContains string
	expectedSide string
}

func structuralCases() []structuralExpectation {
	return []structuralExpectation{
		{
			hallazgo:     "H-013",
			relPath:      "venta_service.go",
			noteContains: `"Venta — divisa pendiente de entregar al cliente"`,
			expectedSide: "ccSideIn",
		},
		{
			hallazgo:     "H-014",
			relPath:      "venta_service.go",
			noteContains: `"Venta — pago pendiente del cliente"`,
			expectedSide: "ccSideOut",
		},
		{
			hallazgo:     "H-015",
			relPath:      "compra_service.go",
			noteContains: `"Compra — divisa pendiente de cobro al cliente"`,
			expectedSide: "ccSideOut",
		},
		{
			hallazgo:     "H-016",
			relPath:      "compra_service.go",
			noteContains: `"Compra — pago pendiente al cliente"`,
			expectedSide: "ccSideIn",
		},
	}
}

func TestCCSign_StructuralInvariant_VentaCompra(t *testing.T) {
	t.Parallel()

	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller(0) failed; no se puede ubicar el test file")
	}
	servicesDir := filepath.Dir(thisFile)

	for _, c := range structuralCases() {
		c := c
		t.Run(c.hallazgo, func(t *testing.T) {
			fullPath := filepath.Join(servicesDir, c.relPath)
			raw, err := os.ReadFile(fullPath)
			if err != nil {
				t.Fatalf("read %s: %v", fullPath, err)
			}
			src := string(raw)

			noteIdx := strings.Index(src, c.noteContains)
			if noteIdx < 0 {
				t.Fatalf("%s: no se encontró la nota %s en %s — ¿alguien cambió el texto del cc_entry?",
					c.hallazgo, c.noteContains, c.relPath)
			}

			// Buscamos hacia atrás desde la nota hasta el inicio de la
			// invocación a applyCCImpactTx. La call está en una sola línea.
			lineStart := strings.LastIndex(src[:noteIdx], "\n")
			if lineStart < 0 {
				lineStart = 0
			}
			line := src[lineStart:noteIdx]
			if !strings.Contains(line, "applyCCImpactTx(") {
				t.Fatalf("%s: la nota %s no aparece dentro de una invocación applyCCImpactTx en %s",
					c.hallazgo, c.noteContains, c.relPath)
			}
			if !strings.Contains(line, c.expectedSide) {
				t.Fatalf("%s (%s en %s): side esperado %q no aparece en la línea de la invocación.\n"+
					"Convención: cc_service.go:37 / cc_repo.go:56 (negative = client owes more, positive = debt reduction).\n"+
					"Línea encontrada:\n%s",
					c.hallazgo, c.noteContains, c.relPath, c.expectedSide, strings.TrimSpace(line))
			}

			// Defensa adicional: el side opuesto NO debe aparecer en la misma
			// línea (paranoia ante reescrituras parciales).
			oppositeSide := ccSideOut
			if c.expectedSide == ccSideOut {
				oppositeSide = ccSideIn
			}
			// Evitamos matchear "ccSideIn" cuando el side correcto es
			// "ccSideOut" simplemente por substring (uno contiene al otro
			// como prefijo de manera ambigua). Validamos por palabra completa.
			if hasIdent(line, oppositeSide) {
				t.Fatalf("%s (%s en %s): aparece también el side opuesto %q en la misma línea, lo que es ambiguo.\nLínea: %s",
					c.hallazgo, c.noteContains, c.relPath, oppositeSide, strings.TrimSpace(line))
			}
		})
	}
}

// hasIdent verifica que `ident` aparezca en `s` como identificador completo
// (delimitado por bordes no alfanuméricos), no como substring de otra palabra.
func hasIdent(s, ident string) bool {
	idx := 0
	for {
		j := strings.Index(s[idx:], ident)
		if j < 0 {
			return false
		}
		start := idx + j
		end := start + len(ident)
		left := byte(' ')
		right := byte(' ')
		if start > 0 {
			left = s[start-1]
		}
		if end < len(s) {
			right = s[end]
		}
		if !isIdentByte(left) && !isIdentByte(right) {
			return true
		}
		idx = end
	}
}

func isIdentByte(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || b == '_'
}
