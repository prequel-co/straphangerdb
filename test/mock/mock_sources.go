package mock

import (
	"context"
	"time"

	"github.com/prequel-co/straphangerdb/pkg/plugin"
)

type MockEmbeddedPlugin struct {
	id       string
	agencyID string
	mode     plugin.IngestionMode
	data     []byte
}

func NewMockPlugin(id, agencyID string, mode plugin.IngestionMode, data []byte) *MockEmbeddedPlugin {
	return &MockEmbeddedPlugin{
		id:       id,
		agencyID: agencyID,
		mode:     mode,
		data:     data,
	}
}

func (m *MockEmbeddedPlugin) ID() string {
	return m.id
}

func (m *MockEmbeddedPlugin) AgencyID() string {
	return m.agencyID
}

func (m *MockEmbeddedPlugin) TargetTable() string {
	return "mock_table"
}

func (m *MockEmbeddedPlugin) Mode() plugin.IngestionMode {
	return m.mode
}

func (m *MockEmbeddedPlugin) DefaultInterval() time.Duration {
	return 100 * time.Millisecond
}

func (m *MockEmbeddedPlugin) Fetch(ctx context.Context) ([]byte, error) {
	return m.data, nil
}

func (m *MockEmbeddedPlugin) TransformSelect(rawTable string) string {
	return "SELECT * FROM " + rawTable
}

func (m *MockEmbeddedPlugin) TransformQuery(rawTable string) string {
	return "SELECT * FROM " + rawTable
}

