# Querying UDS via S3 Tables + Athena (Security SQL)

When you need SQL, large-scale scans, joins with non-log data, or analytics-engine access, use
the **S3 Tables integration**: UDS mirrors log data into an AWS-managed `aws-cloudwatch` table
bucket as Apache Iceberg tables, queryable with Amazon Athena (and Redshift, SageMaker Unified
Studio, or any Iceberg tool). This complements Logs Insights (best for fast, facet-scoped,
recent investigation).

> A dedicated, deeper skill exists for the mechanics of this integration:
> **`querying-aws-cloudwatch`** (S3 Tables enablement, IAM/Lake Formation, schemas, 40+ data
> sources). Prefer it for setup and non-security data-source coverage; this file focuses on the
> **security** sources (CloudTrail, VPC Flow Logs, WAF, Route 53 Resolver) and correlation.

## Logs Insights vs. Athena — pick the tool

| Use Logs Insights (facets) when… | Use Athena / S3 Tables when… |
|---|---|
| Fast triage, recent data, interactive facet drill-down | Long lookbacks over large volumes; heavy aggregation |
| Query without knowing log group names | Need SQL joins across data sources or with business/S3 metadata |
| Live-ish incident response | Scheduled reporting, ML feature prep, cross-tool access (Redshift/SageMaker) |

## Critical behaviors (state these to the operator)

- **No backfill** — only events after the integration/association are in the tables.
- **Retention follows the log group** — the S3 Tables copy is NOT independent storage. When data
  expires from (or a log group is deleted in) CloudWatch Logs, it is removed from the table too.
- **No extra storage charge** beyond CloudWatch ingestion; you pay for Athena scanning.
- Namespaces follow `<service>__<type>`, e.g. `aws_cloudtrail__management`, `amazon_vpc__flow`,
  `aws_waf__logs`, `amazon_route53resolver__query`.

## 1. Check if enabled

```
aws s3tables list-table-buckets --region <REGION> --query "tableBuckets[?name=='aws-cloudwatch']"
```
- Empty → integration not enabled (enable below).
- Present → list what is available:
```
aws s3tables list-namespaces --table-bucket-arn arn:aws:s3tables:<REGION>:<ACCOUNT>:bucket/aws-cloudwatch --region <REGION>
aws s3tables list-tables --table-bucket-arn arn:aws:s3tables:<REGION>:<ACCOUNT>:bucket/aws-cloudwatch --namespace <NAMESPACE> --region <REGION>
```

## 2. Enable / associate (state-changing — confirm first)

```
# Create the integration (KMS optional; use a CMK for compliance)
aws observabilityadmin create-s3-table-integration \
  --region <REGION> \
  --encryption '{"SseAlgorithm":"aws:kms","KmsKeyArn":"<KMS_KEY_ARN>"}' \
  --role-arn <SERVICE_ROLE_ARN>

# Associate security sources specifically (recommended over wildcard)
aws logs associate-source-to-s3-table-integration --region <REGION> \
  --integration-arn <INTEGRATION_ARN> \
  --data-source '{"name":"aws_cloudtrail","type":"management"}'
aws logs associate-source-to-s3-table-integration --region <REGION> \
  --integration-arn <INTEGRATION_ARN> \
  --data-source '{"name":"amazon_vpc","type":"flow"}'
```
Prefer specific associations over `{"name":"*","type":"*"}` so only intended (and potentially
sensitive) data lands in queryable tables. Service-role trust/permission policies and KMS key
policy are in the `querying-aws-cloudwatch` skill's Security Considerations.

> Enablement rules do not auto-enable the S3 Tables integration — enable it per account/Region.

## 3. Grant query access

Requires the S3 Tables federated catalog registered in Glue (`s3tablescatalog`), Lake Formation
`SELECT`/`DESCRIBE` grants (or IAM-only mode where supported), and Athena permissions.
```
aws lakeformation grant-permissions --region <REGION> \
  --principal DataLakePrincipalIdentifier=<ROLE_ARN> \
  --resource '{"Table":{"CatalogId":"<ACCOUNT>:s3tablescatalog/aws-cloudwatch","DatabaseName":"<NAMESPACE>","Name":"<TABLE>"}}' \
  --permissions DESCRIBE SELECT
```

## 4. Always inspect the schema first

Schemas vary per data source and AWS may update them. Before writing SQL, run once per namespace
(returns all tables + columns + types) and include it in your response:
```
aws glue get-tables --catalog-id "<ACCOUNT>:s3tablescatalog/aws-cloudwatch" --database-name "<namespace>" --region <REGION>
```

## 5. Security SQL query patterns

Table reference form: `"s3tablescatalog/aws-cloudwatch"."<namespace>"."<table>"`.
Confirm the Athena workgroup + output location (with SSE-KMS) before executing.

VPC Flow Logs — rejected traffic by source:
```sql
SELECT srcaddr, dstaddr, dstport, protocol, COUNT(*) AS rejects, SUM(bytes) AS total_bytes
FROM "s3tablescatalog/aws-cloudwatch"."amazon_vpc__flow"."<table>"
WHERE action = 'REJECT'
GROUP BY srcaddr, dstaddr, dstport, protocol
ORDER BY rejects DESC
LIMIT 50;
```

CloudTrail — access-denied over a long window:
```sql
SELECT errorcode, eventname, useridentity.arn AS principal, sourceipaddress, COUNT(*) AS n
FROM "s3tablescatalog/aws-cloudwatch"."aws_cloudtrail__management"."<table>"
WHERE errorcode IN ('AccessDenied','UnauthorizedAccess','AccessDeniedException','Client.UnauthorizedAccess')
GROUP BY errorcode, eventname, useridentity.arn, sourceipaddress
ORDER BY n DESC
LIMIT 100;
```
> Nested/struct fields (e.g. `useridentity`) and exact column names depend on the schema — verify
> with `get-tables`; some columns are structs you address with dot/`.` or that arrive flattened.

WAF — blocked requests by rule:
```sql
SELECT terminatingruleid, action, COUNT(*) AS hits
FROM "s3tablescatalog/aws-cloudwatch"."aws_waf__logs"."<table>"
WHERE action = 'BLOCK'
GROUP BY terminatingruleid, action
ORDER BY hits DESC
LIMIT 50;
```

Correlate API errors with network REJECTs by IP (cross-source threat signal):
```sql
SELECT ct.sourceipaddress AS ip,
       COUNT(DISTINCT ct.eventid) AS api_errors,
       COUNT(vpc.srcaddr)        AS network_rejects
FROM "s3tablescatalog/aws-cloudwatch"."aws_cloudtrail__management"."<ct_table>" ct
LEFT JOIN "s3tablescatalog/aws-cloudwatch"."amazon_vpc__flow"."<vpc_table>" vpc
  ON ct.sourceipaddress = vpc.srcaddr AND vpc.action = 'REJECT'
WHERE ct.errorcode IS NOT NULL
GROUP BY ct.sourceipaddress
ORDER BY api_errors DESC, network_rejects DESC
LIMIT 50;
```

Correlate with non-log data (e.g. S3 object metadata) — see the `querying-aws-cloudwatch` skill
for join patterns against `s3tablescatalog/aws-s3` journal tables (cost attribution, exfil).

## 6. Run it with Athena

```
aws athena start-query-execution \
  --query-string "<SQL>" \
  --work-group <WORKGROUP> \
  --result-configuration OutputLocation=s3://<ATHENA_OUTPUT_BUCKET>/,EncryptionConfiguration={EncryptionOption=SSE_KMS,KmsKey=<KMS_KEY_ARN>} \
  --region <REGION>
aws athena get-query-execution --query-execution-id <ID> --region <REGION>   # poll to SUCCEEDED
aws athena get-query-results   --query-execution-id <ID> --region <REGION>
```

## Security controls

- Treat all tables as sensitive (IPs, ARNs, request params). Use Lake Formation column-level
  security to restrict fields like `srcaddr`/`sourceipaddress`.
- Encrypt Athena output (SSE-KMS) and restrict the output bucket.
- Prefer specific data-source associations over wildcard.
- Enable CloudTrail on Athena (`StartQueryExecution`, `GetQueryResults`) and Lake Formation grant
  APIs to audit who queried what.

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `aws-cloudwatch` bucket not found | Integration not created | `create-s3-table-integration` |
| Bucket exists, no namespaces | No sources associated / no traffic yet | Associate sources; generate activity |
| `CATALOG_NOT_FOUND` in Athena | S3 Tables not registered in Glue | Enable integration in S3 console → Table buckets |
| `AccessDenied` on query | Missing Lake Formation / IAM grants | Grant `DESCRIBE`+`SELECT` (step 3) |
| Empty results | No backfill; source idle | Confirm association + active source |
| Column not found | Schema updated by AWS | Re-run `get-tables` |

## References

- Existing skill: **`querying-aws-cloudwatch`** (deep S3 Tables/Athena mechanics)
- [S3 Tables integration](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/s3-tables-integration.html)
- [Integrating S3 Tables with analytics services](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-tables-integrating-aws.html)
- [Lake Formation permissions](https://docs.aws.amazon.com/lake-formation/latest/dg/granting-catalog-permissions.html)
