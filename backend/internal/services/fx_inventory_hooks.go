package services

// fxInventoryMovementHook se registra desde la composición del router (una instancia por proceso).
var fxInventoryMovementHook *FxInventoryService

// SetFxInventoryMovementHook conecta inventario FX a confirmación y anulación de movimientos.
func SetFxInventoryMovementHook(s *FxInventoryService) {
	fxInventoryMovementHook = s
}
