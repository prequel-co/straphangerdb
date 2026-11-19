package semantic

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadIndex(t *testing.T) {
	data, err := OssieFS.ReadFile("ossie/index.json")
	if err != nil {
		t.Fatalf("failed to read embedded ossie/index.json: %v", err)
	}

	idx, err := LoadIndex(data)
	if err != nil {
		t.Fatalf("failed to parse index.json: %v", err)
	}

	if idx.Version != "0.2.0.dev0" {
		t.Errorf("expected version 0.2.0.dev0, got %s", idx.Version)
	}

	if len(idx.Themes) != 6 {
		t.Fatalf("expected 6 themes, got %d", len(idx.Themes))
	}

	for _, theme := range idx.Themes {
		if theme.ID == "" || theme.Name == "" {
			t.Errorf("theme missing id or name: %+v", theme)
		}
		for cat, relPath := range theme.Models {
			fullPath := filepath.Join("ossie", relPath)
			if _, err := OssieFS.ReadFile(fullPath); err != nil {
				t.Errorf("theme %s catalog %s model file %s not found in embed: %v", theme.ID, cat, fullPath, err)
			}
		}
	}
}

func TestAllSemanticModels(t *testing.T) {
	files, err := GetAllEmbeddedFiles()
	if err != nil {
		t.Fatalf("failed to get all embedded files: %v", err)
	}

	modelCount := 0
	ducklakeCount := 0
	icebergCount := 0

	for path, data := range files {
		if !strings.HasSuffix(path, ".ossie.yaml") {
			continue
		}
		modelCount++
		if strings.Contains(path, "ducklake/") {
			ducklakeCount++
		}
		if strings.Contains(path, "iceberg/") {
			icebergCount++
		}

		model, err := LoadModel(data)
		if err != nil {
			t.Errorf("failed to load model %s: %v", path, err)
			continue
		}

		if err := ValidateModel(model); err != nil {
			t.Errorf("model validation failed for %s: %v", path, err)
		}

		// Verify datasets and relationships
		for _, rel := range model.Relationships {
			if len(rel.FromColumns) != len(rel.ToColumns) {
				t.Errorf("model %s relationship %s column length mismatch: %d vs %d",
					path, rel.Name, len(rel.FromColumns), len(rel.ToColumns))
			}
		}

		// Verify that all fields have non-empty expression dialects
		for _, ds := range model.Datasets {
			for _, f := range ds.Fields {
				if f.Expression != nil {
					if len(f.Expression.Dialects) == 0 {
						t.Errorf("model %s dataset %s field %s has no dialects", path, ds.Name, f.Name)
					}
					for _, d := range f.Expression.Dialects {
						if d.Expression == "" {
							t.Errorf("model %s dataset %s field %s dialect %s has empty expression",
								path, ds.Name, f.Name, d.Dialect)
						}
					}
				}
			}
		}
	}

	if modelCount != 12 {
		t.Fatalf("expected 12 semantic models, found %d", modelCount)
	}
	if ducklakeCount != 6 {
		t.Errorf("expected 6 ducklake models, found %d", ducklakeCount)
	}
	if icebergCount != 6 {
		t.Errorf("expected 6 iceberg models, found %d", icebergCount)
	}
}
