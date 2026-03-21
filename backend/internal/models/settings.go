package models

import "encoding/json"

var SettingsDefaults = map[string]json.RawMessage{
	"lockout_enabled":                      json.RawMessage(`true`),
	"lockout_max_attempts":                 json.RawMessage(`5`),
	"lockout_minutes":                      json.RawMessage(`15`),
	"pin_enabled_for_courier":              json.RawMessage(`true`),
	"pin_min_length":                       json.RawMessage(`4`),
	"pin_max_length":                       json.RawMessage(`8`),
	"cc_cross_payment_strict_equal_amount": json.RawMessage(`true`),
	"pending_allow_partial_resolution":     json.RawMessage(`true`),
	"cc_allow_positive_balance":            json.RawMessage(`true`),
	"cc_allow_overpay":                     json.RawMessage(`true`),
}

func IsValidSettingsKey(key string) bool {
	_, ok := SettingsDefaults[key]
	return ok
}
