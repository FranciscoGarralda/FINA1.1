package services

import (
	"context"
	"fmt"
	"math/big"
	"strings"

	"github.com/jackc/pgx/v5"
)

const (
	ccSideIn  = "IN"
	ccSideOut = "OUT"
)

func normalizeAmountString(raw string) (string, error) {
	r, ok := new(big.Rat).SetString(raw)
	if !ok || r.Sign() <= 0 {
		return "", ErrInvalidAmount
	}
	return strings.TrimRight(strings.TrimRight(r.FloatString(8), "0"), "."), nil
}

func signedCCAmount(amount, side string) (string, error) {
	normalized, err := normalizeAmountString(amount)
	if err != nil {
		return "", err
	}
	switch side {
	case ccSideIn:
		return normalized, nil
	case ccSideOut:
		return "-" + normalized, nil
	default:
		return "", fmt.Errorf("invalid cc side: %s", side)
	}
}

func applyCCImpactTx(ctx context.Context, ccSvc *CCService, tx pgx.Tx, clientID, currencyID, amount, movementID, side, note, callerID string) error {
	signed, err := signedCCAmount(amount, side)
	if err != nil {
		return err
	}
	_, err = ccSvc.ApplyEntry(ctx, tx, ApplyCCEntryInput{
		ClientID:   clientID,
		CurrencyID: currencyID,
		Amount:     signed,
		MovementID: movementID,
		Note:       &note,
	}, callerID)
	return err
}
