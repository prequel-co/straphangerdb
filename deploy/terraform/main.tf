terraform {
  required_version = ">= 1.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

# --- Cloudflare Variables ---
variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare Account ID"
}

variable "cloudflare_api_token" {
  type        = string
  sensitive   = true
  description = "Cloudflare API Token"
}

variable "r2_access_key" {
  type        = string
  sensitive   = true
  default     = ""
  description = "R2 Storage Access Key ID"
}

variable "r2_secret_key" {
  type        = string
  sensitive   = true
  default     = ""
  description = "R2 Storage Secret Access Key"
}

# --- GCP Cloud Run Variables ---
variable "gcp_project_id" {
  type        = string
  description = "Google Cloud Project ID"
}

variable "gcp_region" {
  type        = string
  default     = "us-central1"
  description = "Google Cloud Region for Cloud Run"
}

variable "container_image" {
  type        = string
  default     = ""
  description = "Container image URL (e.g. gcr.io/my-project/straphanger-db:latest). If empty, defaults to gcr.io/<gcp_project_id>/straphanger-db:latest"
}

variable "environment" {
  type        = string
  default     = "prod"
  description = "Deployment environment"
}

# --- Providers ---
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

# --- Cloudflare R2 Storage & Iceberg REST Data Catalog ---
resource "cloudflare_r2_bucket" "straphanger_db" {
  account_id = var.cloudflare_account_id
  name       = "straphanger-db-${var.environment}"
}

resource "cloudflare_r2_data_catalog" "straphanger_catalog" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.straphanger_db.name
}

locals {
  iceberg_catalog_uri = "https://catalog.cloudflarestorage.com/${var.cloudflare_account_id}/${cloudflare_r2_bucket.straphanger_db.name}"
  image_url           = var.container_image != "" ? var.container_image : "gcr.io/${var.gcp_project_id}/straphanger-db:latest"
}

# --- Google Cloud Run v2 Persistent Daemon Service ---
resource "google_cloud_run_v2_service" "straphanger_daemon" {
  name     = "straphanger-db-${var.environment}"
  location = var.gcp_region
  ingress  = "INGRESS_TRAFFIC_ALL"

  labels = {
    project    = "straphangerdb"
    service    = "straphangerdb"
    managed_by = "terraform"
    env        = var.environment
  }

  template {
    labels = {
      project    = "straphangerdb"
      service    = "straphangerdb"
      managed_by = "terraform"
      env        = var.environment
    }
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    containers {
      image = local.image_url

      resources {
        limits = {
          cpu    = "1"
          memory = "4Gi"
        }
        # Always-On CPU allocation: CPU is never throttled when idle, ensuring 24/7 continuous background ingestion loops
        cpu_idle = false
      }

      env {
        name  = "SQLITE_DB_PATH"
        value = "/data/control.db"
      }

      env {
        name  = "OTF_FORMAT"
        value = "all"
      }

      env {
        name  = "R2_BUCKET_NAME"
        value = cloudflare_r2_bucket.straphanger_db.name
      }

      env {
        name  = "R2_ACCESS_KEY_ID"
        value = var.r2_access_key
      }

      env {
        name  = "R2_SECRET_ACCESS_KEY"
        value = var.r2_secret_key
      }

      env {
        name  = "ICEBERG_CATALOG_URI"
        value = local.iceberg_catalog_uri
      }

      env {
        name  = "CLOUDFLARE_ACCOUNT_ID"
        value = var.cloudflare_account_id
      }

      env {
        name  = "CLOUDFLARE_API_TOKEN"
        value = var.cloudflare_api_token
      }

      env {
        name  = "LITESTREAM_SYNC_INTERVAL"
        value = "30s"
      }
    }
  }
}



# --- Terraform Outputs ---
output "r2_bucket_name" {
  value       = cloudflare_r2_bucket.straphanger_db.name
  description = "Name of the created Cloudflare R2 bucket"
}

output "iceberg_catalog_uri" {
  value       = local.iceberg_catalog_uri
  description = "Cloudflare R2 Data Catalog Iceberg REST URI for DuckDB ATTACH"
}

output "cloud_run_service_name" {
  value       = google_cloud_run_v2_service.straphanger_daemon.name
  description = "Google Cloud Run service name"
}

output "cloud_run_service_uri" {
  value       = google_cloud_run_v2_service.straphanger_daemon.uri
  description = "Google Cloud Run service URI"
}
