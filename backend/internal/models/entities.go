package models

type UserListItem struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
	Active   bool   `json:"active"`
}

type AccountListItem struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}

type CurrencyListItem struct {
	ID     string `json:"id"`
	Code   string `json:"code"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}

type AccountCurrencyItem struct {
	CurrencyID     string `json:"currency_id"`
	CurrencyCode   string `json:"currency_code"`
	CurrencyName   string `json:"currency_name"`
	CashEnabled    bool   `json:"cash_enabled"`
	DigitalEnabled bool   `json:"digital_enabled"`
}

type ClientListItem struct {
	ID            string `json:"id"`
	ClientCode    int64  `json:"client_code"`
	FirstName     string `json:"first_name"`
	LastName      string `json:"last_name"`
	Phone         string `json:"phone"`
	DNI           string `json:"dni"`
	AddressStreet string `json:"address_street"`
	AddressNumber string `json:"address_number"`
	AddressFloor  string `json:"address_floor"`
	Department    string `json:"department"`
	Active        bool   `json:"active"`
	CcEnabled     bool   `json:"cc_enabled"`
}

type ClientDetail struct {
	ID               string `json:"id"`
	ClientCode       int64  `json:"client_code"`
	FirstName        string `json:"first_name"`
	LastName         string `json:"last_name"`
	Phone            string `json:"phone"`
	DNI              string `json:"dni"`
	AddressStreet    string `json:"address_street"`
	AddressNumber    string `json:"address_number"`
	AddressFloor     string `json:"address_floor"`
	ReferenceContact string `json:"reference_contact"`
	ReferredBy       string `json:"referred_by"`
	Department       string `json:"department"`
	Active           bool   `json:"active"`
	CcEnabled        bool   `json:"cc_enabled"`
}
