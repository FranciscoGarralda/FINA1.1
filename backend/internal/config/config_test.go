package config

import "testing"

func TestCORSAllowOrigin_devLocalhost(t *testing.T) {
	t.Parallel()
	cfg := &Config{CORSDevLocalhost: true, CORSExplicitOrigins: nil}

	tests := []struct {
		origin string
		want   bool
	}{
		{"http://localhost:5173", true},
		{"http://127.0.0.1:5174", true},
		{"http://localhost:3000", true},
		{"http://localhost:9999", false},
		{"http://localhost:5173/", false},
		{"https://localhost:5173", false},
		{"", false},
		{"http://evil.com:5173", false},
	}
	for _, tt := range tests {
		t.Run(tt.origin, func(t *testing.T) {
			t.Parallel()
			_, ok := cfg.CORSAllowOrigin(tt.origin)
			if ok != tt.want {
				t.Fatalf("CORSAllowOrigin(%q) ok=%v want %v", tt.origin, ok, tt.want)
			}
		})
	}
}

func TestCORSAllowOrigin_explicitList(t *testing.T) {
	t.Parallel()
	cfg := &Config{
		CORSDevLocalhost:    false,
		CORSExplicitOrigins: []string{"https://app.example.com", "https://other.net"},
	}
	if _, ok := cfg.CORSAllowOrigin("https://app.example.com"); !ok {
		t.Fatal("expected allowed")
	}
	if _, ok := cfg.CORSAllowOrigin("https://evil.com"); ok {
		t.Fatal("expected denied")
	}
}

func TestMustRequireStrongJWT(t *testing.T) {
	t.Run("off when env flags unset", func(t *testing.T) {
		t.Setenv("REQUIRE_JWT_SECRET", "")
		t.Setenv("FINA_ENV", "")
		t.Setenv("APP_ENV", "")
		t.Setenv("RAILWAY_ENVIRONMENT", "")
		if mustRequireStrongJWT() {
			t.Fatal("expected false")
		}
	})
	t.Run("REQUIRE_JWT_SECRET", func(t *testing.T) {
		t.Setenv("REQUIRE_JWT_SECRET", "1")
		t.Setenv("FINA_ENV", "")
		t.Setenv("APP_ENV", "")
		t.Setenv("RAILWAY_ENVIRONMENT", "")
		if !mustRequireStrongJWT() {
			t.Fatal("expected true")
		}
	})
	t.Run("FINA_ENV production", func(t *testing.T) {
		t.Setenv("REQUIRE_JWT_SECRET", "")
		t.Setenv("FINA_ENV", "production")
		t.Setenv("APP_ENV", "")
		t.Setenv("RAILWAY_ENVIRONMENT", "")
		if !mustRequireStrongJWT() {
			t.Fatal("expected true")
		}
	})
	t.Run("RAILWAY_ENVIRONMENT production", func(t *testing.T) {
		t.Setenv("REQUIRE_JWT_SECRET", "")
		t.Setenv("FINA_ENV", "")
		t.Setenv("APP_ENV", "")
		t.Setenv("RAILWAY_ENVIRONMENT", "production")
		if !mustRequireStrongJWT() {
			t.Fatal("expected true")
		}
	})
}
