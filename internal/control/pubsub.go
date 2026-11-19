package control

import (
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"
)

// SimplePubSub provides cross-process pub/sub signaling on SQLite using control_meta or channel signals.
type SimplePubSub struct {
	db     *sqlx.DB
	logger *slog.Logger
	chans  map[string][]chan string
	mu     sync.Mutex
}

func NewPubSub(logger *slog.Logger, db *sqlx.DB) *SimplePubSub {
	return &SimplePubSub{
		db:     db,
		logger: logger,
		chans:  make(map[string][]chan string),
	}
}

// Subscribe returns a channel that receives notification payloads for a given topic.
func (ps *SimplePubSub) Subscribe(topic string) <-chan string {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	ch := make(chan string, 10)
	ps.chans[topic] = append(ps.chans[topic], ch)
	return ch
}

// Publish sends a notification payload to all subscribers of a topic.
func (ps *SimplePubSub) Publish(topic, payload string) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	listeners := ps.chans[topic]
	ps.logger.Info("publishing notification", "topic", topic, "payload", payload, "listeners", len(listeners))

	for _, ch := range listeners {
		select {
		case ch <- payload:
		default:
		}
	}
}

// WaitForBootstrap blocks until the "sys:bootstrap" topic receives "initialized" or schema_initialized is 1 in DB.
func (ps *SimplePubSub) WaitForBootstrap(topic string, timeout time.Duration) error {
	if IsSchemaInitialized(ps.db) {
		return nil
	}

	sub := ps.Subscribe(topic)
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for {
		select {
		case msg := <-sub:
			if msg == "initialized" {
				return nil
			}
		case <-timer.C:
			if IsSchemaInitialized(ps.db) {
				return nil
			}
			return fmt.Errorf("timeout waiting for bootstrap signal on topic %s", topic)
		}
	}
}
