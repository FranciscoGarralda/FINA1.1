package models

import (
	"encoding/hex"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

type User struct {
	ID                  pgtype.UUID
	Username            string
	PasswordHash        string
	Role                string
	PinHash             pgtype.Text
	Active              bool
	FailedLoginAttempts int
	LockedUntil         pgtype.Timestamptz
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

func (u *User) IDString() string {
	if !u.ID.Valid {
		return ""
	}
	b := u.ID.Bytes
	var buf [36]byte
	hex.Encode(buf[0:8], b[0:4])
	buf[8] = '-'
	hex.Encode(buf[9:13], b[4:6])
	buf[13] = '-'
	hex.Encode(buf[14:18], b[6:8])
	buf[18] = '-'
	hex.Encode(buf[19:23], b[8:10])
	buf[23] = '-'
	hex.Encode(buf[24:36], b[10:16])
	return string(buf[:])
}
