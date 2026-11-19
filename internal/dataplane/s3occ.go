package dataplane

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

// ErrOCCConflict indicates an optimistic concurrency control conflict (HTTP 412).
var ErrOCCConflict = errors.New("s3 occ conflict: precondition failed (remote object changed)")

// S3OCCClient provides atomic conditional upload and download operations on R2 / S3.
type S3OCCClient struct {
	client *s3.Client
	logger *slog.Logger
	bucket string
	mu     sync.Mutex
}

// NewS3OCCClient initializes an S3 client configured for Cloudflare R2 or standard S3.
func NewS3OCCClient(logger *slog.Logger, bucket string) (*S3OCCClient, error) {
	keyID := os.Getenv("R2_ACCESS_KEY_ID")
	secret := os.Getenv("R2_SECRET_ACCESS_KEY")
	accountID := os.Getenv("CLOUDFLARE_ACCOUNT_ID")
	endpoint := os.Getenv("S3_ENDPOINT")

	if endpoint == "" && accountID != "" {
		endpoint = fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID)
	}

	if keyID == "" || secret == "" {
		return nil, fmt.Errorf("missing R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY")
	}

	cfg, err := awsconfig.LoadDefaultConfig(
		context.Background(),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(keyID, secret, "")),
		awsconfig.WithRegion("auto"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize aws config: %w", err)
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		if endpoint != "" {
			o.BaseEndpoint = aws.String(endpoint)
		}
		o.UsePathStyle = true
	})

	return &S3OCCClient{
		client: client,
		logger: logger,
		bucket: bucket,
	}, nil
}

// DownloadCatalog checks if a remote catalog file exists and downloads it locally, returning the remote ETag.
func (s *S3OCCClient) DownloadCatalog(ctx context.Context, key string, localPath string) (etag string, exists bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) {
			if apiErr.ErrorCode() == "NoSuchKey" || apiErr.ErrorCode() == "NotFound" {
				return "", false, nil
			}
		}
		if strings.Contains(err.Error(), "404") || strings.Contains(err.Error(), "NoSuchKey") {
			return "", false, nil
		}
		return "", false, fmt.Errorf("failed to get remote object s3://%s/%s: %w", s.bucket, key, err)
	}
	defer out.Body.Close()

	remoteETag := ""
	if out.ETag != nil {
		remoteETag = strings.Trim(*out.ETag, "\"")
	}

	f, err := os.Create(localPath)
	if err != nil {
		return "", false, fmt.Errorf("failed creating local file %s: %w", localPath, err)
	}
	defer f.Close()

	if _, err := io.Copy(f, out.Body); err != nil {
		return "", false, fmt.Errorf("failed writing downloaded catalog to %s: %w", localPath, err)
	}

	s.logger.Info("downloaded remote ducklake catalog", "bucket", s.bucket, "key", key, "etag", remoteETag, "local_path", localPath)
	return remoteETag, true, nil
}

// UploadCatalogOCC uploads a local catalog file to R2 using Optimistic Concurrency Control (ETag).
func (s *S3OCCClient) UploadCatalogOCC(ctx context.Context, key string, localPath string, currentETag string) (newETag string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	f, err := os.Open(localPath)
	if err != nil {
		return "", fmt.Errorf("failed to open local file %s for OCC upload: %w", localPath, err)
	}
	defer f.Close()

	input := &s3.PutObjectInput{
		Bucket:       aws.String(s.bucket),
		Key:          aws.String(key),
		Body:         f,
		CacheControl: aws.String("public, max-age=60, s-maxage=60"),
		ContentType:  aws.String("application/vnd.duckdb.db"),
	}

	// Apply conditional headers if ETag is tracked
	if currentETag != "" {
		quoted := fmt.Sprintf("\"%s\"", currentETag)
		input.IfMatch = aws.String(quoted)
	}

	start := time.Now()
	out, err := s.client.PutObject(ctx, input)
	if err != nil {
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) {
			if apiErr.ErrorCode() == "PreconditionFailed" || apiErr.ErrorCode() == "412" {
				return "", ErrOCCConflict
			}
		}
		if strings.Contains(err.Error(), "412") || strings.Contains(err.Error(), "PreconditionFailed") {
			return "", ErrOCCConflict
		}
		return "", fmt.Errorf("failed s3 occ put object: %w", err)
	}

	if out.ETag != nil {
		newETag = strings.Trim(*out.ETag, "\"")
	}

	s.logger.Info("successfully synced ducklake catalog via OCC", "bucket", s.bucket, "key", key, "new_etag", newETag, "duration", time.Since(start))
	return newETag, nil
}

// CheckRemoteETag retrieves the current remote ETag without downloading the full body.
func (s *S3OCCClient) CheckRemoteETag(ctx context.Context, key string) (string, error) {
	head, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return "", err
	}
	if head.ETag != nil {
		return strings.Trim(*head.ETag, "\""), nil
	}
	return "", nil
}

// DeleteObjects deletes multiple object keys under a bucket.
func (s *S3OCCClient) DeleteObjects(ctx context.Context, keys []string) error {
	for _, k := range keys {
		_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
			Bucket: aws.String(s.bucket),
			Key:    aws.String(k),
		})
		if err != nil {
			s.logger.Warn("error deleting object from R2", "bucket", s.bucket, "key", k, "error", err)
		}
	}
	return nil
}

// PutObjectBytesConditional puts an in-memory byte slice to R2/S3.
// If ifNoneMatch is true, it sets IfNoneMatch: "*" (fails with ErrOCCConflict if object already exists).
// If ifMatchETag is provided, it sets IfMatch to that ETag.
func (s *S3OCCClient) PutObjectBytesConditional(ctx context.Context, key string, data []byte, ifNoneMatch bool, ifMatchETag string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	input := &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(key),
		Body:          bytes.NewReader(data),
		ContentLength: aws.Int64(int64(len(data))),
		ContentType:   aws.String("application/json"),
	}

	if strings.Contains(key, "_delta_log") || strings.Contains(key, "version-hint.text") || strings.Contains(key, "metadata") || strings.Contains(key, "catalog") {
		input.CacheControl = aws.String("public, max-age=60, s-maxage=60")
	}

	if ifNoneMatch {
		input.IfNoneMatch = aws.String("*")
	} else if ifMatchETag != "" {
		quoted := fmt.Sprintf("\"%s\"", strings.Trim(ifMatchETag, "\""))
		input.IfMatch = aws.String(quoted)
	}

	out, err := s.client.PutObject(ctx, input)
	if err != nil {
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) {
			if apiErr.ErrorCode() == "PreconditionFailed" || apiErr.ErrorCode() == "412" {
				return "", ErrOCCConflict
			}
		}
		if strings.Contains(err.Error(), "412") || strings.Contains(err.Error(), "PreconditionFailed") {
			return "", ErrOCCConflict
		}
		return "", fmt.Errorf("failed conditional put object s3://%s/%s: %w", s.bucket, key, err)
	}

	newETag := ""
	if out.ETag != nil {
		newETag = strings.Trim(*out.ETag, "\"")
	}
	return newETag, nil
}

// ListObjectsPrefix returns all keys starting with prefix.
func (s *S3OCCClient) ListObjectsPrefix(ctx context.Context, prefix string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var keys []string
	paginator := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(s.bucket),
		Prefix: aws.String(prefix),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed listing objects with prefix %s: %w", prefix, err)
		}
		for _, obj := range page.Contents {
			if obj.Key != nil {
				keys = append(keys, *obj.Key)
			}
		}
	}
	return keys, nil
}

// GetObjectBytes reads an entire object into bytes.
func (s *S3OCCClient) GetObjectBytes(ctx context.Context, key string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, err
	}
	defer out.Body.Close()
	return io.ReadAll(out.Body)
}

// ObjectExists checks if an object exists in the bucket.
func (s *S3OCCClient) ObjectExists(ctx context.Context, key string) (bool, error) {
	_, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) {
			if apiErr.ErrorCode() == "NoSuchKey" || apiErr.ErrorCode() == "NotFound" {
				return false, nil
			}
		}
		if strings.Contains(err.Error(), "404") || strings.Contains(err.Error(), "NoSuchKey") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// PutStaticObject uploads an in-memory byte slice to R2/S3 without conditional checks, setting Content-Type and Cache-Control.
func (s *S3OCCClient) PutStaticObject(ctx context.Context, key string, data []byte, contentType string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if contentType == "" {
		contentType = "application/octet-stream"
	}

	input := &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(key),
		Body:          bytes.NewReader(data),
		ContentLength: aws.Int64(int64(len(data))),
		ContentType:   aws.String(contentType),
		CacheControl:  aws.String("public, max-age=300"),
	}

	_, err := s.client.PutObject(ctx, input)
	if err != nil {
		return fmt.Errorf("failed put static object s3://%s/%s: %w", s.bucket, key, err)
	}
	return nil
}

// Suppress unused import warning
var _ = http.StatusOK

