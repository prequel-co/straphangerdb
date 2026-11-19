package e2e

import (
	"net/http"
	"os"
	"testing"
	"time"
)

func TestE2EContainerEnvironment(t *testing.T) {
	endpoint := os.Getenv("E2E_S3_ENDPOINT")
	if endpoint == "" {
		t.Skip("skipping live Docker Compose E2E test: set E2E_S3_ENDPOINT (e.g. http://localhost:9000) to run against active RustFS/Lakekeeper stack")
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(endpoint + "/minio/health/ready")
	if err != nil {
		t.Fatalf("failed reaching E2E S3 endpoint %s: %v", endpoint, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unexpected health status from E2E S3 endpoint: %d", resp.StatusCode)
	}
}
