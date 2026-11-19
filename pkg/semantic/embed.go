package semantic

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"

	"gopkg.in/yaml.v3"
)

//go:embed ossie/*
var OssieFS embed.FS

// DialectExpression represents dialect-specific SQL expressions in Ossie 0.2.0.dev0.
type DialectExpression struct {
	Dialect    string `yaml:"dialect" json:"dialect"`
	Expression string `yaml:"expression" json:"expression"`
}

// ExpressionDef wraps dialect expressions.
type ExpressionDef struct {
	Dialects []DialectExpression `yaml:"dialects" json:"dialects"`
}

// DimensionDef holds dimension properties such as time dimension status.
type DimensionDef struct {
	IsTime bool `yaml:"is_time,omitempty" json:"is_time,omitempty"`
}

// FieldDef represents a column or calculated attribute in an Ossie dataset.
type FieldDef struct {
	Name        string         `yaml:"name" json:"name"`
	Description string         `yaml:"description,omitempty" json:"description,omitempty"`
	Datatype    string         `yaml:"datatype,omitempty" json:"datatype,omitempty"`
	Expression  *ExpressionDef `yaml:"expression,omitempty" json:"expression,omitempty"`
	Dimension   *DimensionDef  `yaml:"dimension,omitempty" json:"dimension,omitempty"`
}

// MetricDef represents an aggregated metric at dataset or model scope.
type MetricDef struct {
	Name        string         `yaml:"name" json:"name"`
	Description string         `yaml:"description,omitempty" json:"description,omitempty"`
	Expression  ExpressionDef  `yaml:"expression" json:"expression"`
	Datatype    string         `yaml:"datatype,omitempty" json:"datatype,omitempty"`
}

// DatasetDef represents a physical or logical relation (table or view).
type DatasetDef struct {
	Name        string      `yaml:"name" json:"name"`
	Description string      `yaml:"description,omitempty" json:"description,omitempty"`
	Source      string      `yaml:"source" json:"source"`
	PrimaryKey  []string    `yaml:"primary_key,omitempty" json:"primary_key,omitempty"`
	Fields      []FieldDef  `yaml:"fields,omitempty" json:"fields,omitempty"`
	Metrics     []MetricDef `yaml:"metrics,omitempty" json:"metrics,omitempty"`
}

// RelationshipDef defines join semantics between datasets.
type RelationshipDef struct {
	Name        string   `yaml:"name" json:"name"`
	From        string   `yaml:"from" json:"from"`
	To          string   `yaml:"to" json:"to"`
	FromColumns []string `yaml:"from_columns" json:"from_columns"`
	ToColumns   []string `yaml:"to_columns" json:"to_columns"`
	Type        string   `yaml:"type,omitempty" json:"type,omitempty"`
}

// AIContextDef contains natural language context for LLM agents.
type AIContextDef struct {
	Instructions string `yaml:"instructions,omitempty" json:"instructions,omitempty"`
}

// ModelDef represents a complete Apache Ossie 0.2.0.dev0 semantic model.
type ModelDef struct {
	Version       string            `yaml:"version" json:"version"`
	Name          string            `yaml:"name" json:"name"`
	Description   string            `yaml:"description,omitempty" json:"description,omitempty"`
	AIContext     *AIContextDef     `yaml:"ai_context,omitempty" json:"ai_context,omitempty"`
	Datasets      []DatasetDef      `yaml:"datasets" json:"datasets"`
	Relationships []RelationshipDef `yaml:"relationships,omitempty" json:"relationships,omitempty"`
	Metrics       []MetricDef       `yaml:"metrics,omitempty" json:"metrics,omitempty"`
}

// ThemeIndexEntry describes a theme in the central index.
type ThemeIndexEntry struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Models      map[string]string `json:"models"`
}

// OssieIndex describes the root catalog index of available models.
type OssieIndex struct {
	Version string            `json:"version"`
	Themes  []ThemeIndexEntry `json:"themes"`
}

// LoadModel parses an Ossie YAML model from raw bytes.
func LoadModel(data []byte) (*ModelDef, error) {
	var file struct {
		Version       string     `yaml:"version" json:"version"`
		SemanticModel []ModelDef `yaml:"semantic_model" json:"semantic_model"`
	}
	if err := yaml.Unmarshal(data, &file); err == nil && len(file.SemanticModel) > 0 {
		m := file.SemanticModel[0]
		if m.Version == "" {
			m.Version = file.Version
		}
		return &m, nil
	}

	var m ModelDef
	if err := yaml.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("failed to parse Ossie model YAML: %w", err)
	}
	return &m, nil
}

// LoadIndex parses the Ossie index.json file.
func LoadIndex(data []byte) (*OssieIndex, error) {
	var idx OssieIndex
	if err := json.Unmarshal(data, &idx); err != nil {
		return nil, fmt.Errorf("failed to parse Ossie index.json: %w", err)
	}
	return &idx, nil
}

// ValidateModel performs structural verification of an Ossie model definition.
func ValidateModel(m *ModelDef) error {
	if m.Version != "0.2.0.dev0" {
		return fmt.Errorf("expected version 0.2.0.dev0, got %q", m.Version)
	}
	if m.Name == "" {
		return fmt.Errorf("model name is required")
	}
	if len(m.Datasets) == 0 {
		return fmt.Errorf("model %s must have at least one dataset", m.Name)
	}
	datasetNames := make(map[string]bool)
	for _, ds := range m.Datasets {
		if ds.Name == "" {
			return fmt.Errorf("dataset in %s missing name", m.Name)
		}
		if ds.Source == "" {
			return fmt.Errorf("dataset %s in %s missing source", ds.Name, m.Name)
		}
		datasetNames[ds.Name] = true
		for _, f := range ds.Fields {
			if f.Name == "" {
				return fmt.Errorf("dataset %s in %s contains field without name", ds.Name, m.Name)
			}
			if f.Expression != nil {
				for _, d := range f.Expression.Dialects {
					if d.Expression == "" {
						return fmt.Errorf("dataset %s field %s has empty expression", ds.Name, f.Name)
					}
				}
			}
		}
	}
	for _, rel := range m.Relationships {
		if !datasetNames[rel.From] {
			return fmt.Errorf("relationship %s references unknown 'from' dataset %q", rel.Name, rel.From)
		}
		if !datasetNames[rel.To] {
			return fmt.Errorf("relationship %s references unknown 'to' dataset %q", rel.Name, rel.To)
		}
		if len(rel.FromColumns) == 0 || len(rel.ToColumns) == 0 {
			return fmt.Errorf("relationship %s has empty join columns", rel.Name)
		}
		if len(rel.FromColumns) != len(rel.ToColumns) {
			return fmt.Errorf("relationship %s column count mismatch: %d from vs %d to", rel.Name, len(rel.FromColumns), len(rel.ToColumns))
		}
	}
	return nil
}

// GetAllEmbeddedFiles returns a map of relative path to file bytes within ossie/
func GetAllEmbeddedFiles() (map[string][]byte, error) {
	files := make(map[string][]byte)
	err := fs.WalkDir(OssieFS, "ossie", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		data, err := OssieFS.ReadFile(path)
		if err != nil {
			return err
		}
		files[path] = data
		return nil
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}
