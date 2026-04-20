$yaml = @'
pipeline:
  name: tm2-example
  client: internal
  version: "1.0"
  entity: ExampleEntity
  description: Example pipeline reading from the TM2 SQL Server container.

source:
  adapter: mssql
  connection: ${TM2_MSSQL}
  query: |
    SELECT
      Id,
      Code,
      Name,
      Email,
      PostCode,
      Country,
      Amount,
      CreatedAt
    FROM dbo.ExampleTable
    WHERE Active = 1

dq:
  stopOnCritical: true
  rejectionFile: ./output/tm2-example-rejected.csv
  rules:
    - field: Id
      checks:
        - type: notNull
          severity: critical
        - type: unique
          severity: critical
    - field: Code
      checks:
        - type: notNull
          severity: critical
        - type: maxLength
          value: 20
          severity: warning
    - field: Email
      checks:
        - type: email
          severity: warning
    - field: PostCode
      checks:
        - type: ukPostcode
          severity: warning
    - field: Amount
      checks:
        - type: min
          value: 0
          severity: critical
    - field: Country
      checks:
        - type: allowedValues
          value: [GB, IE, US, DE, FR]
          severity: warning

transform:
  lookups: []
  fields:
    - from: Id
      to: RecordId
      type: string
      max: 20
    - from: Code
      to: Code
      type: string
      max: 20
      cleanse: trim|uppercase
    - from: Name
      to: Name
      type: string
      max: 100
      cleanse: trim|titleCase
    - from: Email
      to: Email
      type: string
      cleanse: trim|lowercase
    - from: PostCode
      to: ZipCode
      type: string
      cleanse: trim|uppercase
    - from: Country
      to: Country
      type: string
      default: GB
    - from: Amount
      to: Amount
      type: decimal
      precision: 2
    - from: CreatedAt
      to: CreatedAt
      type: date
      format: YYYY-MM-DD
    - to: Source
      type: constant
      value: TM2

target:
  adapter: csv
  output: ./output/tm2-example.csv
  includeHeader: true
  delimiter: ","
  encoding: utf-8
  nullValue: ""

run:
  mode: full
  batchSize: 500
  onError: continue
  logLevel: info
  dryRun: false
  outputDir: ./output
'@

$yaml | Set-Content -Path "examples/tm2-example.pipeline.yaml" -Encoding UTF8 -Force
Write-Host "File written successfully"
Get-Item "examples/tm2-example.pipeline.yaml" | Select-Object -Property Name, Length
