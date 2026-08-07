# CloudWatch Unified Data Store — Concepts

Background for working with UDS on security data. Read this once to understand the building
blocks the other references rely on.

## What UDS is

The Unified Data Store consolidates operational, security, and compliance **log** data across
AWS services, accounts, and Regions into CloudWatch Logs, then makes it queryable in place and
via SQL — without ETL and without depending on log group names. Key properties:

- **Automatic collection** of AWS vended logs (CloudTrail management/data events, VPC Flow Logs,
  WAF, Route 53 Resolver, EKS control plane, NLB access logs, S3 server access logs, and more),
  with managed connectors for third-party sources (CrowdStrike, Okta, Entra ID, Wiz, Zscaler,
  Palo Alto, Microsoft 365, Windows Event Logs, GitHub, ServiceNow CMDB, etc.).
- **Normalization** to standard schemas: managed **OCSF** (Open Cybersecurity Schema Framework)
  conversion for security data and **OTel** for telemetry, applied at ingestion.
- **Discovery via facets** so queries and dashboards find the right logs by data source, not by
  name.
- **Open access** via Apache Iceberg tables in Amazon S3 Tables — query with Athena, Redshift,
  SageMaker Unified Studio, or any Iceberg-compatible tool, at no additional storage charge.

## Data sources

A **data source** identifies where a log came from, as two attributes:
- **Data source name** — the service/application (e.g. `aws_cloudtrail`, `amazon_vpc`,
  `aws_waf`, `amazon_route53resolver`).
- **Data source type** — the specific log type from that service (e.g. CloudTrail `management`
  vs `data`; VPC `flow`).

CloudWatch assigns these automatically to Standard log class log groups carrying recognized AWS
vended logs. They power both facet-based Logs Insights queries and the S3 Tables namespace
layout (`<service>__<type>`, e.g. `amazon_vpc__flow`).

Discover what is present in a Region:
```
aws logs list-aggregate-log-group-summaries --group-by DATA_SOURCE_NAME_AND_TYPE --region <REGION>
```
Inspect the fields a data source exposes:
```
aws logs get-log-fields --data-source-name <name> --data-source-type <type> --region <REGION>
```

## Facets

A **facet** is a log field surfaced for interactive filtering, grouping, and analysis in the
Logs Insights console — and usable inside queries via `filterIndex`.

- **Default facets** (no configuration, on all Standard log class log groups):
  `@data_source_name`, `@data_source_type`, `@data_format`, `@aws.region`. If resource tags for
  telemetry are enabled, `@aws.tag.*` facets are added.
- **Custom facets** are created from **field index policies** (`PutIndexPolicy`) on fields you
  query often. Recommended for **low-cardinality** fields (< ~100 distinct values/day); high-
  cardinality facet values are not displayed. Facet values/counts are approximate and retained
  ~30 days.
- Facets are computed from logs **ingested in the account**. In a cross-account **monitoring**
  account you cannot see facets built from source-account logs (but you can still query them).

## Field indexes (and why filterIndex matters)

Field indexes speed up and lower the cost of Logs Insights queries by letting the engine skip
log groups/events that cannot match.

- `filterIndex fieldName in [...]` restricts a query to log groups indexed on that field and
  scans only matching events; it also only returns results from after the index existed.
- Default field indexes exist on every Standard log class log group: `@logStream`,
  `@aws.region`, `@aws.account`, `@source.log`, `traceId` — and the UDS default facets above.
- Index policies: up to 40 account-level policies (20 by log-group-name prefix, 20 by data
  source name+type), up to 20 fields each; matches are case-sensitive. Log-group-level policies
  override account-level ones. Only Standard log class supports field index policies.

Example — index security fields on a data source so they become facets:
```
aws logs put-index-policy \
  --log-group-identifier "<LOG_GROUP>" \
  --policy-document '{"FieldsV2":{"errorCode":{"type":"FACET"},"eventName":{"type":"FACET"},"sourceIPAddress":{"type":"FACET"}}}' \
  --region <REGION>
```

## OCSF normalization

UDS can convert AWS security logs to **OCSF** at ingestion via a pipeline processor
(`parseToOCSF` / transformer). This gives a consistent schema across sources for detection and
investigation. The dashboard template ships both a **Standard** (native AWS field names) and an
**OCSF** variant — pick the one that matches how your logs are stored.

- `parseToOCSF` valid `eventSource` values: `CloudTrail | Route53Resolver | VPCFlow | EKSAudit
  | AWSWAF`. `ocsfVersion`: `V1.1 | V1.5`.
- Pipeline (`ocsf`) processor supports `cloud_trail`, `route53_resolver`, `vpc_flow`,
  `eks_audit`, `aws_waf`, `aws_nlb` schemas for `cloudwatch_logs` source at version `1.5`.

### Security field map (Standard ↔ OCSF)

Use this when translating queries between the two dashboard formats.

| Meaning | Standard (native) | OCSF |
|---|---|---|
| API/operation name | `eventName` | `api.operation` |
| Service | `eventSource` | `api.service.name` |
| Actor / principal | `userIdentity.arn`, `userIdentity.type` | `actor.user.name`, `actor.user.type` |
| Source IP | `sourceIPAddress` | `src_endpoint.ip` |
| Error / status | `errorCode`, `errorMessage` | `status`, `status_detail`, `status_id` (1 = success) |
| Account / Region | `recipientAccountId`, `awsRegion` | `cloud.account.uid`, `cloud.region` |
| Event class/type | `eventType` | `class_name`, `activity_name`, `severity` |
| VPC action | `action` (ACCEPT/REJECT) | `action` (Allowed/Denied/Blocked) |
| VPC src/dst | `srcAddr`, `dstAddr`, `dstPort` | `src_endpoint.ip`, `dst_endpoint.ip`, `dst_endpoint.port` |
| VPC bytes | `bytes` | `traffic.bytes` |
| Protocol | `protocol` | `connection_info.protocol_name` |

## Pipelines

Transformation pipelines apply consistent processing (parse, enrich, OCSF-convert, redact, field
ops) to all logs from a given data source name+type. Managed OCSF conversion and Grok/JSON/
key-value parsing are available. Pipelines are how normalization happens before data lands in
log groups and the S3 Tables mirror.

## S3 Tables integration (SQL access)

The integration mirrors log data into an AWS-managed `aws-cloudwatch` **table bucket** as Apache
Iceberg tables, queryable via Athena (and other Iceberg tools). Critical behaviors:

- **No additional storage charge** beyond CloudWatch ingestion.
- **No backfill** — only events after association appear.
- **Retention follows the log group** — the S3 Tables copy is NOT independent storage; when data
  expires from (or a log group is deleted in) CloudWatch Logs, it is removed from the table too.
- Namespaces follow `<service>__<type>` (e.g. `amazon_vpc__flow`, `aws_cloudtrail__management`).

Details and SQL security queries: [querying-s3-tables-athena.md](querying-s3-tables-athena.md).

## Cross-account / cross-Region

Two complementary models (see [cross-account-centralization.md](cross-account-centralization.md)):
- **Cross-account observability** — query logs in place from a monitoring account (no copy).
- **Logs centralization** — replicate logs from many accounts/Regions into a destination
  account for a single pane, enriched with `@aws.account` / `@aws.region`.

## References

- [UDS launch (AWS News Blog)](https://aws.amazon.com/blogs/aws/amazon-cloudwatch-introduces-unified-data-management-and-analytics-for-operations-security-and-compliance/)
- [Use facets to group and explore logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatchLogs-Facets.html)
- [Features enabled by data sources](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/features-enabled-by-data-sources.html)
- [Field index syntax and quotas](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatchLogs-Field-Indexing-Syntax.html)
- [parseToOCSF processor](https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_ParseToOCSF.html)
- [S3 Tables integration](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/s3-tables-integration.html)
