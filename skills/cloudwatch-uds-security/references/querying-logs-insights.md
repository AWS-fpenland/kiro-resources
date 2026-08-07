# Querying UDS with CloudWatch Logs Insights (Security)

How to run facet-scoped security queries over the Unified Data Store with Logs Insights, plus a
reusable library of CloudTrail + VPC Flow Logs queries (Standard and OCSF) and an incident-
response playbook. These are the same query patterns the dashboard uses, extracted so an agent
can run them ad hoc for investigation.

## Query fundamentals for UDS

Scope every query with `SOURCE logGroups()` and narrow with `filterIndex` on the default facets —
no log group names required:

```
SOURCE logGroups()
| filterIndex @data_source_type in ["management"]
| filterIndex @data_source_name in ["aws_cloudtrail"]
| <fields / filter / stats / sort / limit>
```

- `SOURCE logGroups()` is CLI/API-only (the console uses its picker). It scopes across all
  Standard-class log groups in the account — and linked source accounts when run in a monitoring
  account. Optional keywords: `namePrefix` (≤5), `accountIdentifier` (≤20), `logGroupClass`.
- `filterIndex fieldName in [...]` uses field indexes/facets to skip non-matching log
  groups/events — faster and cheaper than `filter`, and essential when scanning many log groups.
- Data source values: CloudTrail = `aws_cloudtrail` (type `management` or `data`); VPC Flow Logs
  = `amazon_vpc` (type `flow`).
- `filterIndex fieldName like /.../` does NOT use the index; prefer `= ` / `in [...]` on indexed
  fields, then refine with `filter ... like` for regex.

## Running a query with the AWS CLI / MCP

```
# Start
aws logs start-query \
  --start-time <EPOCH_SECONDS> --end-time <EPOCH_SECONDS> \
  --query-string 'SOURCE logGroups() | filterIndex @data_source_name in ["aws_cloudtrail"] | fields @timestamp, eventName, errorCode | filter ispresent(errorCode) | sort @timestamp desc | limit 50' \
  --region <REGION>
# Fetch (poll until Status = Complete)
aws logs get-query-results --query-id <QUERY_ID> --region <REGION>
```

Choose a time window that matches the investigation (recent for triage, wider for hunting).
Larger windows scan more data and cost more — lean on `filterIndex` and `limit`.

## Security query library — Standard format (CloudTrail)

Access-denied / unauthorized activity:
```
SOURCE logGroups() | filterIndex @data_source_type in ["management"] | filterIndex @data_source_name in ["aws_cloudtrail"]
| fields @timestamp, errorCode, eventName, userIdentity.arn, sourceIPAddress, recipientAccountId, awsRegion
| filter errorCode in ["AccessDenied","UnauthorizedAccess","Client.UnauthorizedAccess","AccessDeniedException","AuthFailure"]
| stats count(*) as ErrorCount by errorCode, eventName, recipientAccountId, awsRegion | sort ErrorCount desc | limit 50
```

Root account usage:
```
SOURCE logGroups() | filterIndex @data_source_name in ["aws_cloudtrail"]
| fields @timestamp, eventName, sourceIPAddress, recipientAccountId, awsRegion
| filter userIdentity.type = "Root" | sort @timestamp desc | limit 50
```

IAM privilege-escalation indicators:
```
SOURCE logGroups() | filterIndex @data_source_name in ["aws_cloudtrail"]
| fields @timestamp, eventName, eventSource, userIdentity.arn, sourceIPAddress
| filter eventSource in ["iam.amazonaws.com","sts.amazonaws.com"]
| filter eventName in ["CreateUser","AttachUserPolicy","AttachRolePolicy","PutUserPolicy","PutRolePolicy","CreateAccessKey","CreateLoginProfile","AssumeRole","UpdateAssumeRolePolicy","CreateRole","AddUserToGroup","DeactivateMFADevice","DeleteVirtualMFADevice","PutGroupPolicy"]
| stats count(*) as EventCount by eventName, userIdentity.arn | sort EventCount desc | limit 50
```

Console login failures (credential stuffing / brute force):
```
SOURCE logGroups() | filterIndex @data_source_name in ["aws_cloudtrail"]
| fields @timestamp, userIdentity.arn, sourceIPAddress, errorCode
| filter eventName = "ConsoleLogin" | stats count(*) as Attempts by errorCode, userIdentity.arn, sourceIPAddress | sort Attempts desc | limit 50
```

External source IPs by API activity (drop RFC1918 + AWS service calls):
```
SOURCE logGroups() | filterIndex @data_source_name in ["aws_cloudtrail"]
| fields sourceIPAddress as IP, userIdentity.arn, eventName, errorCode, recipientAccountId, awsRegion
| filter sourceIPAddress not like /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/
| filter sourceIPAddress not like /amazonaws\.com/
| stats count(*) as APICount, count(errorCode) as ErrorCount by IP, recipientAccountId, awsRegion | sort APICount desc | limit 50
```

MFA device changes:
```
SOURCE logGroups() | filterIndex @data_source_name in ["aws_cloudtrail"]
| fields @timestamp, eventName, userIdentity.arn, sourceIPAddress
| filter eventName in ["DeactivateMFADevice","DeleteVirtualMFADevice","EnableMFADevice","CreateVirtualMFADevice"]
| stats count(*) as EventCount by eventName, userIdentity.arn | sort EventCount desc | limit 20
```

## Security query library — Standard format (VPC Flow Logs)

Rejected connections from external IPs:
```
SOURCE logGroups() | filterIndex @data_source_type in ["flow"] | filterIndex @data_source_name in ["amazon_vpc"]
| fields srcAddr as IP, dstPort, action
| filter action = "REJECT" | filter srcAddr not like /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/
| stats count(*) as RejectCount by IP, dstPort | sort RejectCount desc | limit 50
```

Top blocked connections + bytes (targeting / misconfig):
```
SOURCE logGroups() | filterIndex @data_source_name in ["amazon_vpc"]
| fields srcAddr, dstAddr, dstPort, protocol, bytes
| filter action = "REJECT" | stats count(*) as BlockedCount, sum(bytes) as TotalBytes by srcAddr, dstAddr | sort BlockedCount desc | limit 50
```

Unusual destination ports (scanning / exploitation, e.g. 22/3389/445):
```
SOURCE logGroups() | filterIndex @data_source_name in ["amazon_vpc"]
| fields dstPort | filter ispresent(dstPort) | stats count(*) as HitCount by dstPort | sort HitCount desc | limit 20
```

Possible exfiltration — high accepted egress by external destination:
```
SOURCE logGroups() | filterIndex @data_source_name in ["amazon_vpc"]
| fields dstAddr, bytes, action
| filter action = "ACCEPT" | filter dstAddr not like /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/
| stats sum(bytes) as TotalBytes, count(*) as Flows by dstAddr | sort TotalBytes desc | limit 25
```

## OCSF format equivalents

Swap the field names using the Standard↔OCSF map in [uds-concepts.md](uds-concepts.md). Examples:

Failed API activities (OCSF; `status_id != 1` means not-success):
```
SOURCE logGroups() | filterIndex @data_source_name in ["aws_cloudtrail"]
| fields @timestamp, api.operation, status, actor.user.name, src_endpoint.ip, cloud.account.uid, cloud.region
| filter status_id != 1 | stats count(*) as FailureCount by api.operation, cloud.account.uid, cloud.region | sort FailureCount desc | limit 50
```

Blocked network traffic (OCSF):
```
SOURCE logGroups() | filterIndex @data_source_name in ["amazon_vpc"]
| fields src_endpoint.ip as IP, dst_endpoint.port, action
| filter action = "Denied" or action = "Blocked"
| filter src_endpoint.ip not like /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/
| stats count(*) as BlockCount by IP, dst_endpoint.port | sort BlockCount desc | limit 50
```

## Correlation & incident-response playbook

Because CloudTrail (`aws_cloudtrail`) and VPC Flow Logs (`amazon_vpc`) are queried through the
same facet mechanism, you can pivot between the API layer and the network layer quickly:

1. **Spot anomaly** — error-rate spike, root usage, or REJECT surge (queries above).
2. **Identify actors** — pull external source IPs with high API errors (CloudTrail) and IPs with
   high network REJECT counts (VPC). An IP in **both** lists is a strong malicious signal.
3. **Scope the blast radius** — for a suspect IP/ARN, list all `eventName`/`api.operation` and
   affected `recipientAccountId`/`awsRegion`; check for privilege-escalation or MFA changes.
4. **Assess data movement** — check accepted egress bytes to external destinations from the same
   sources (exfiltration query).
5. **Preserve context** — the Detailed Events Timeline query returns the most recent errored
   events with full context for the incident record.
6. **Go deeper/older** — for long lookbacks or heavy aggregation, switch to SQL over S3 Tables
   ([querying-s3-tables-athena.md](querying-s3-tables-athena.md)); for alerting, add alarms
   ([alarms-and-monitoring.md](alarms-and-monitoring.md)).

## Tips

- **Interactive exploration:** in the console, use the facet panel — select `@data_source_name`
  and a value like `aws_cloudtrail`, then facet values (e.g. `errorCode = AccessDenied`) to build
  filters without hand-writing syntax.
- **Cross-account:** run from a monitoring account to include linked source accounts; add
  `accountIdentifier` to `SOURCE` to target specific ones. Facet *panels* only reflect the local
  account, but queries still return source-account results.
- **Performance/cost:** always keep `filterIndex` + `limit`; index hot fields as facets; narrow
  the time window.

## References

- [SOURCE command](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Source.html)
- [filterIndex](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-FilterIndex.html)
- [Logs Insights query syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html)
- [Analyze log data with facets](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/AnalyzingLogData.html)
