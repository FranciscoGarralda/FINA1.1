package repositories

import (
	"context"
	"errors"
	"math/big"

	"fina/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ClientRepo struct {
	pool *pgxpool.Pool
}

var ErrInvalidCCAdjustmentAmount = errors.New("INVALID_CC_ADJUSTMENT_AMOUNT")

func NewClientRepo(pool *pgxpool.Pool) *ClientRepo {
	return &ClientRepo{pool: pool}
}

func (r *ClientRepo) FindByID(ctx context.Context, id string) (*models.ClientDetail, error) {
	var c models.ClientDetail
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, client_code, first_name, last_name, phone, dni,
		        address_street, address_number, address_floor,
		        reference_contact, referred_by, active, cc_enabled
		 FROM clients WHERE id = $1`, id).
		Scan(&c.ID, &c.ClientCode, &c.FirstName, &c.LastName, &c.Phone, &c.DNI,
			&c.AddressStreet, &c.AddressNumber, &c.AddressFloor,
			&c.ReferenceContact, &c.ReferredBy, &c.Active, &c.CcEnabled)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &c, nil
}

type ClientInput struct {
	FirstName            string                     `json:"first_name"`
	LastName             string                     `json:"last_name"`
	Phone                string                     `json:"phone"`
	DNI                  string                     `json:"dni"`
	AddressStreet        string                     `json:"address_street"`
	AddressNumber        string                     `json:"address_number"`
	AddressFloor         string                     `json:"address_floor"`
	ReferenceContact     string                     `json:"reference_contact"`
	ReferredBy           string                     `json:"referred_by"`
	CcEnabled            bool                       `json:"cc_enabled"`
	CcBalanceAdjustments []CCBalanceAdjustmentInput `json:"cc_balance_adjustments,omitempty"`
}

type CCBalanceAdjustmentInput struct {
	CurrencyID string `json:"currency_id"`
	Amount     string `json:"amount"`
	Reason     string `json:"reason,omitempty"`
}

type CCBalanceAdjustmentResult struct {
	CurrencyID    string
	DeltaAmount   string
	BalanceBefore string
	BalanceAfter  string
	Origin        string
	Reason        string
}

func (r *ClientRepo) Create(ctx context.Context, input ClientInput) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx,
		`INSERT INTO clients (first_name, last_name, phone, dni,
		        address_street, address_number, address_floor,
		        reference_contact, referred_by, cc_enabled)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id::text`,
		input.FirstName, input.LastName, input.Phone, input.DNI,
		input.AddressStreet, input.AddressNumber, input.AddressFloor,
		input.ReferenceContact, input.ReferredBy, input.CcEnabled).Scan(&id)
	return id, err
}

func (r *ClientRepo) CreateTx(ctx context.Context, tx pgx.Tx, input ClientInput) (string, error) {
	var id string
	err := tx.QueryRow(ctx,
		`INSERT INTO clients (first_name, last_name, phone, dni,
		        address_street, address_number, address_floor,
		        reference_contact, referred_by, cc_enabled)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id::text`,
		input.FirstName, input.LastName, input.Phone, input.DNI,
		input.AddressStreet, input.AddressNumber, input.AddressFloor,
		input.ReferenceContact, input.ReferredBy, input.CcEnabled).Scan(&id)
	return id, err
}

func (r *ClientRepo) Update(ctx context.Context, id string, input ClientInput) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE clients SET first_name=$2, last_name=$3, phone=$4, dni=$5,
		        address_street=$6, address_number=$7, address_floor=$8,
		        reference_contact=$9, referred_by=$10, cc_enabled=$11,
		        updated_at=now()
		 WHERE id=$1`,
		id, input.FirstName, input.LastName, input.Phone, input.DNI,
		input.AddressStreet, input.AddressNumber, input.AddressFloor,
		input.ReferenceContact, input.ReferredBy, input.CcEnabled)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *ClientRepo) UpdateTx(ctx context.Context, tx pgx.Tx, id string, input ClientInput) error {
	tag, err := tx.Exec(ctx,
		`UPDATE clients SET first_name=$2, last_name=$3, phone=$4, dni=$5,
		        address_street=$6, address_number=$7, address_floor=$8,
		        reference_contact=$9, referred_by=$10, cc_enabled=$11,
		        updated_at=now()
		 WHERE id=$1`,
		id, input.FirstName, input.LastName, input.Phone, input.DNI,
		input.AddressStreet, input.AddressNumber, input.AddressFloor,
		input.ReferenceContact, input.ReferredBy, input.CcEnabled)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *ClientRepo) FindByIDTx(ctx context.Context, tx pgx.Tx, id string) (*models.ClientDetail, error) {
	var c models.ClientDetail
	err := tx.QueryRow(ctx,
		`SELECT id::text, client_code, first_name, last_name, phone, dni,
		        address_street, address_number, address_floor,
		        reference_contact, referred_by, active, cc_enabled
		 FROM clients WHERE id = $1`, id).
		Scan(&c.ID, &c.ClientCode, &c.FirstName, &c.LastName, &c.Phone, &c.DNI,
			&c.AddressStreet, &c.AddressNumber, &c.AddressFloor,
			&c.ReferenceContact, &c.ReferredBy, &c.Active, &c.CcEnabled)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &c, nil
}

func (r *ClientRepo) ApplyCCBalanceAdjustmentsTx(ctx context.Context, tx pgx.Tx, clientID string, adjustments []CCBalanceAdjustmentInput, origin, userID string) ([]CCBalanceAdjustmentResult, error) {
	results := make([]CCBalanceAdjustmentResult, 0, len(adjustments))

	for _, adj := range adjustments {
		var currencyActive bool
		if err := tx.QueryRow(ctx, `SELECT active FROM currencies WHERE id = $1`, adj.CurrencyID).Scan(&currencyActive); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrNotFound
			}
			return nil, err
		}
		if !currencyActive {
			return nil, ErrCurrencyNotEnabled
		}

		delta, ok := new(big.Rat).SetString(adj.Amount)
		if !ok || delta.Sign() == 0 {
			return nil, ErrInvalidCCAdjustmentAmount
		}

		before := new(big.Rat)
		var beforeRaw string
		err := tx.QueryRow(ctx,
			`SELECT balance::text
			 FROM cc_balances
			 WHERE client_id = $1 AND currency_id = $2
			 FOR UPDATE`,
			clientID, adj.CurrencyID).Scan(&beforeRaw)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if err == nil {
			parsed, ok := new(big.Rat).SetString(beforeRaw)
			if !ok {
				return nil, ErrInvalidCCAdjustmentAmount
			}
			before = parsed
		}

		after := new(big.Rat).Add(before, delta)
		if _, err := tx.Exec(ctx,
			`INSERT INTO cc_balances (client_id, currency_id, balance)
			 VALUES ($1, $2, $3::numeric)
			 ON CONFLICT (client_id, currency_id)
			 DO UPDATE SET balance = EXCLUDED.balance, updated_at = now()`,
			clientID, adj.CurrencyID, ratTrimCC(after)); err != nil {
			return nil, err
		}

		reason := adj.Reason
		if reason == "" && origin == "OPENING_CC" {
			reason = "Saldo inicial CC"
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO cc_manual_adjustments
			    (client_id, currency_id, delta_amount, balance_before, balance_after, origin, reason, created_by_user_id)
			 VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6, $7, $8)`,
			clientID, adj.CurrencyID, ratTrimCC(delta), ratTrimCC(before), ratTrimCC(after), origin, reason, userID); err != nil {
			return nil, err
		}

		results = append(results, CCBalanceAdjustmentResult{
			CurrencyID:    adj.CurrencyID,
			DeltaAmount:   ratTrimCC(delta),
			BalanceBefore: ratTrimCC(before),
			BalanceAfter:  ratTrimCC(after),
			Origin:        origin,
			Reason:        reason,
		})
	}

	return results, nil
}

func ratTrimCC(r *big.Rat) string {
	return r.FloatString(8)
}
