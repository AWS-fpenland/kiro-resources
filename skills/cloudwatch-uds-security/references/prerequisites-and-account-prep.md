# Prerequisites & Autonomous Account Preparation

Goal: get `aws_cloudtrail` and `amazon_vpc` (and optionally other security sources) flowing into
CloudWatch Logs as UDS data sources so the dashboard and facet-scoped queries work. This is the
Phase 1 (detect) and Phase 2 (enable) logic for the deployment workflow.

The dashboard is **read-only** and depends only on data sources being present via the
`@data_source_name` facet — it never references specific log group names. If a source is missing,
the corresponding widgets render empty.

## Phase 1 — Detect what already exists (read-only)

Run the aggregate summary; this is the single authoritative check the AWS guide uses:

```
aws logs list-aggregate-log-group-summaries --group-by DATA_SOURCE_NAME_AND_TYPE --region <REGION>
```

Interpret the output:
- Entry with data source name `aws_cloudtrail`, type `management` (and/or `data`) → CloudTrail
  is flowing. Management events are what the dashboard's CloudTrail widgets need.
- Entry with data source name `amazon_vpc`, type `flow` → VPC Flow Logs are flowing.

Decision:
- **Both present** → prerequisites met. Proceed to deploy
  ([deploy-security-dashboard.md](deploy-security-dashboard.md)).
- **One/both missing** → enable them in Phase 2, then re-run this check.

Supporting read-only checks:
```
# Existing trails and whether they already push to CloudWatch Logs
aws cloudtrail describe-trails --region <REGION>
# For a given trail, confirm a CloudWatchLogsLogGroupArn is set
aws cloudtrail get-trail --name <TRAIL_NAME> --region <REGION>

# Existing VPCs (to know scope) and any flow logs already going to CloudWatch
aws ec2 describe-vpcs --region <REGION> --query "Vpcs[].VpcId"
aws ec2 describe-flow-logs --region <REGION> \
  --filter "Name=log-destination-type,Values=cloud-watch-logs"

# Existing telemetry enablement rules (managed auto-config)
aws observabilityadmin list-telemetry-rules --region <REGION>
```

> If `observabilityadmin` commands are unavailable in the caller's CLI/Region, fall back to the
> direct CloudTrail/VPC configuration paths below and note the Region limitation to the operator.

## Phase 2 — Enable missing data sources (state-changing — confirm first)

Prefer **managed telemetry enablement rules** (and service-linked channels) so current and future
resources are covered and drift is remediated. These rules use an AWS Config internal service-
linked recorder for discovery (no CI charges for CloudWatch's own use); enabling incurs CloudTrail
delivery + CloudWatch Logs ingestion charges. Name the cost before proceeding.

### 2a. CloudTrail → CloudWatch Logs

**Option A (recommended): telemetry enablement rule via service-linked channel — no trail
required.** Ingests CloudTrail events into managed log groups `aws/cloudtrail/<event-types>`,
with safety checks and termination protection. Choose at least one event type (management is what
the security dashboard needs; data events add S3/Lambda object-level visibility).

Create the rule (account scope). The rule structure carries `ResourceType`, `TelemetryType`,
`TelemetrySourceTypes`, and a `DestinationConfiguration` with `CloudtrailParameters`; confirm the
exact shape with `aws observabilityadmin create-telemetry-rule help` for your CLI version, then:

```
aws observabilityadmin create-telemetry-rule \
  --rule-name uds-cloudtrail-management \
  --rule '{
    "ResourceType": "AWS::CloudTrail::Trail",
    "TelemetryType": "Logs",
    "TelemetrySourceTypes": ["CLOUDTRAIL_MANAGEMENT_EVENTS"],
    "DestinationConfiguration": {
      "DestinationType": "Amazon CloudWatch Logs",
      "RetentionInDays": 90
    }
  }' \
  --region <REGION>
```

- For organization-wide enablement (run in the management/delegated-admin account), use
  `create-telemetry-rule-for-organization` with the same `--rule` shape. Org rules form the
  baseline; account/OU rules may only add coverage, not reduce it.
- To also capture data events, add/enable a second rule with the data-events source type.
- Use the **Target regions** selector (console) or replicate the rule to add other Regions; the
  current Region becomes the home Region.

**Option B: attach CloudWatch Logs to an existing trail** (when the operator already runs a trail
and prefers not to add a rule). Create a log group + role, then point the trail at it:

```
aws logs create-log-group --log-group-name /aws/cloudtrail/uds-management --region <REGION>

# IAM role trusting cloudtrail.amazonaws.com with logs:CreateLogStream + logs:PutLogEvents
# scoped to that log group (see CloudTrail docs linked below), then:
aws cloudtrail update-trail \
  --name <TRAIL_NAME> \
  --cloud-watch-logs-log-group-arn arn:aws:logs:<REGION>:<ACCOUNT>:log-group:/aws/cloudtrail/uds-management:* \
  --cloud-watch-logs-role-arn arn:aws:iam::<ACCOUNT>:role/<CT_TO_CWL_ROLE> \
  --region <REGION>
```

CloudTrail continues delivering to S3 as before; this adds the CloudWatch Logs path UDS needs.

### 2b. VPC Flow Logs → CloudWatch Logs

**Option A (recommended): telemetry enablement rule for VPC Flow Logs** — covers current and
future VPCs, preserves existing customer-created flow logs, and (with automatic configuration
updates) remediates drift on rule-managed flow logs. It never modifies flow logs you created.

```
aws observabilityadmin create-telemetry-rule \
  --rule-name uds-vpc-flow-logs \
  --rule '{
    "ResourceType": "AWS::EC2::VPC",
    "TelemetryType": "Logs",
    "TelemetrySourceTypes": ["VPC_FLOW_LOGS"],
    "DestinationConfiguration": {
      "DestinationType": "Amazon CloudWatch Logs",
      "DestinationPattern": "/aws/vpc/<vpc-id>",
      "RetentionInDays": 90,
      "VPCFlowLogParameters": { "LogFormat": "", "TrafficType": "ALL", "MaxAggregationInterval": 600 }
    }
  }' \
  --region <REGION>
```

- Use `TrafficType: ALL` so both ACCEPT and REJECT records exist — the dashboard's REJECT/network
  widgets depend on this.
- Macros `<vpc-id>` / `<account-id>` can split log groups. CloudWatch skips VPCs already ingesting
  to CloudWatch Logs.
- Org-wide: `create-telemetry-rule-for-organization`.

**Option B: enable flow logs directly on specific VPCs:**
```
aws logs create-log-group --log-group-name /aws/vpc/flowlogs --region <REGION>
aws ec2 create-flow-logs \
  --resource-type VPC --resource-ids <VPC_ID> \
  --traffic-type ALL \
  --log-destination-type cloud-watch-logs \
  --log-group-name /aws/vpc/flowlogs \
  --deliver-logs-permission-arn arn:aws:iam::<ACCOUNT>:role/<FLOWLOGS_ROLE> \
  --max-aggregation-interval 600 \
  --region <REGION>
```

### 2c. (Optional) other security sources via enablement rules

Same rule mechanism supports additional security-relevant sources. Enable if the operator wants
broader coverage (each becomes its own `@data_source_name`):
- **WAF Web ACL logs** — `AWS::WAFv2::WebACL`, prefix `aws-waf-logs-`.
- **Route 53 Resolver query logs** — resolver query logging, `/aws/route53resolver`.
- **EKS control plane / audit logs** — `AWS::EKS::Cluster`, log types incl. `audit`.
- **NLB access logs**, **S3 server access logs** (tag-based selection; CloudWatch Logs
  destination only — see the querying-aws-cloudwatch guidance for SAL vended delivery).

## Facets and OCSF (optional, improves the experience)

- **Default facets** (`@data_source_name`, `@data_source_type`, `@data_format`, `@aws.region`)
  need no setup — the dashboard relies on these.
- For faster/cheaper investigative queries, add **custom facets/field indexes** on hot security
  fields with `put-index-policy` (see [uds-concepts.md](uds-concepts.md)).
- If the operator wants the **OCSF** dashboard, ensure OCSF conversion is configured for the
  sources (pipeline `parseToOCSF`), then deploy with `LogFormat=OCSF`. Otherwise use `Standard`.

## Verification (close the loop)

After enabling, re-run:
```
aws logs list-aggregate-log-group-summaries --group-by DATA_SOURCE_NAME_AND_TYPE --region <REGION>
```
- New sources may take time to appear and **backfill nothing** — only new events flow. Enablement
  rules can take up to ~24h for initial AWS Config resource discovery in some cases; generate
  activity (or wait) so widgets populate.
- Once `aws_cloudtrail` (`management`) and `amazon_vpc` (`flow`) are present, proceed to deploy.

## IAM the operator/agent needs for Phase 2

- CloudTrail path: `cloudtrail:DescribeTrails/GetTrail/UpdateTrail`, `logs:CreateLogGroup`,
  `iam:PassRole` for the CT→CWL role.
- VPC path: `ec2:DescribeVpcs/DescribeFlowLogs/CreateFlowLogs`, `logs:CreateLogGroup`,
  `iam:PassRole` for the flow-logs delivery role.
- Enablement rules: `observabilityadmin:CreateTelemetryRule/ListTelemetryRules` (and the
  `*-for-organization` variants from the management/delegated-admin account), plus the AWS Config
  service-linked recorder permissions CloudWatch manages.
- Detection: `logs:ListAggregateLogGroupSummaries`, `logs:GetLogFields`.

## References

- [Telemetry enablement rules](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/telemetry-config-rules.html)
- [create-telemetry-rule (CLI)](https://docs.aws.amazon.com/cli/latest/reference/observabilityadmin/create-telemetry-rule.html)
- [Simplified CloudTrail events in CloudWatch (SLC)](https://aws.amazon.com/about-aws/whats-new/2025/12/key-enhancements-cloudtrail-events-cloudwatch/)
- [Send CloudTrail events to CloudWatch Logs](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/send-cloudtrail-events-to-cloudwatch-logs.html)
- [list-aggregate-log-group-summaries (CLI)](https://docs.aws.amazon.com/cli/latest/reference/logs/list-aggregate-log-group-summaries.html)
