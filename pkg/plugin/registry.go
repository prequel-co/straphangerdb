package plugin

import (
	"fmt"
	"sync"
)

var (
	registryMu sync.RWMutex
	sources    = make(map[string]DataSource)
)

// Register registers a DataSource plugin instance.
func Register(ds DataSource) {
	registryMu.Lock()
	defer registryMu.Unlock()

	id := ds.ID()
	if id == "" {
		panic("plugin ID cannot be empty")
	}
	if _, dup := sources[id]; dup {
		panic(fmt.Sprintf("plugin registered twice for ID: %s", id))
	}
	sources[id] = ds
}

// Get retrieves a registered DataSource plugin by ID.
func Get(id string) (DataSource, bool) {
	registryMu.RLock()
	defer registryMu.RUnlock()

	ds, ok := sources[id]
	return ds, ok
}

// List returns all registered DataSource plugins.
func List() []DataSource {
	registryMu.RLock()
	defer registryMu.RUnlock()

	list := make([]DataSource, 0, len(sources))
	for _, ds := range sources {
		list = append(list, ds)
	}
	return list
}
