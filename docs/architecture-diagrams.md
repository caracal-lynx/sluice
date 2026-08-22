# Sluice — Architecture Diagrams

Visual reference for the Sluice ETL toolkit. All diagrams are Mermaid and
render natively in GitHub, VS Code, and most docs portals. A FigJam
blueprint at the bottom mirrors the same structure for whiteboard use.

> _Clean data flows through._

**Verified against `@caracal-lynx/sluice@0.9.6`, 2026-08-22.** Diagrams here are
checked against `src/`, not maintained from memory; every Mermaid block in this
file parses. If you change a phase, an adapter, a rule or an exit code, change
the diagram in the same PR — a diagram that lies is worse than no diagram,
because it is quoted with confidence.

---

## 0. Pipeline stages at a glance

The whole engine in one picture. Everything below this section is a zoom into
one part of it.

Six stages run in a fixed order, three of them optional. **Prep, Enrich and
Merge are skipped entirely unless the pipeline configures them** — a minimal
pipeline is Extract → DQ → Transform → Load.

```mermaid
flowchart TB
    classDef io fill:#ECEFF1,stroke:#546E7A,stroke-width:1.2px,color:#000
    classDef core fill:#1565C0,stroke:#0D47A1,stroke-width:2px,color:#FFF
    classDef opt fill:#BBDEFB,stroke:#1565C0,stroke-width:1.5px,color:#000
    classDef gate fill:#FFE0B2,stroke:#E65100,stroke-width:1.5px,color:#000
    classDef out fill:#F3E5F5,stroke:#6A1B9A,stroke-width:1.2px,color:#000

    Src[/"Legacy sources<br/>mssql · pg · csv · xlsx · rest · json · odoo-csv"/]:::io

    subgraph Per["Per source — repeated for every entry in sources[]"]
      direction TB
      EX["<b>1 Extract</b><br/>adapter → stg_raw or stg_raw_{id}"]:::core
      PP["<b>2 Prep</b> · optional<br/>reshape rows in place"]:::opt
      DQ1["<b>3 Data quality</b><br/>source-scoped rules → _accepted"]:::core
      EX --> PP --> DQ1
    end

    MRG["<b>4 Merge</b> · multi-source only<br/>coalesce · priority-override · union · intersect"]:::opt
    PP2["<b>2 Prep</b> · optional<br/>post-merge rules"]:::opt
    ENR["<b>5 Enrich</b> · optional<br/>private @caracal-lynx/sluice-enrich"]:::opt
    DQ2["<b>3 Data quality</b><br/>unscoped rules"]:::core
    TR["<b>6 Transform</b><br/>map · lookup · expression · cleanse"]:::core
    LD["<b>7 Load</b><br/>adapter → target"]:::core

    Tgt[/"Targets<br/>ifs · bc · bluecherry · csv · pg"/]:::io

    Halt{{"critical violations<br/>+ stopOnCritical → exit 2"}}:::gate
    Dry{{"dryRun or validate-only<br/>stops before load"}}:::gate
    Art[/"Run artefacts<br/>rejections · dq-summary · prep-summary · state · log"/]:::out

    Src --> EX
    DQ1 --> MRG --> PP2 --> ENR --> DQ2 --> TR --> LD --> Tgt
    DQ1 -. "single source: no merge" .-> PP2
    DQ2 -.-> Halt
    TR -.-> Dry
    DQ2 --> Art
    LD --> Art
```

**Reading the order, because it is easy to get wrong:**

- **Extract** — always. One adapter per source; the incremental filter applies
  here.
- **Prep** — only when a `prep:` block is present and `--no-prep` was not
  passed. Mutates the staging table **in place**, before Enrich and DQ. Fires
  once per source pre-merge (rules carrying that `sourceId`) and again
  post-merge (rules with no `sourceId`).
- **Enrich** — only when an `enrich:` block is present, the private package is
  installed, `--no-enrich` was not passed, and the run is neither a dry run nor
  `validate-only`. The implementation is `@caracal-lynx/sluice-enrich`; this
  repo exports only the types. **Skipped silently when the package is absent**,
  so "enrich did nothing" usually means "not installed".
- **DQ** — always. Rejected rows are **not deleted**: they are excluded by
  materialising `{table}_accepted`, leaving the original table inspectable.
- **Merge** — only for `sources[]` + `merge:`, and only under
  `MultiSourcePipelineRunner`.
- **Transform** — always. The only stage that writes `stg_transformed`.
- **Load** — skipped for `dryRun` and `validate-only`.

**Enrich sits between Prep and DQ, not after Transform.** That ordering is
deliberate — enrichment adds columns that DQ rules are then allowed to
validate — and it is the single most common thing people mis-draw.

---

## 1. System context

Where Sluice sits between the client's legacy systems and their target ERP.

```mermaid
flowchart LR
    classDef person fill:#FFE8B2,stroke:#B88400,stroke-width:2px,color:#000
    classDef input fill:#E3F2FD,stroke:#1565C0,stroke-width:1.5px,color:#000
    classDef core fill:#1565C0,stroke:#0D47A1,stroke-width:2px,color:#FFF
    classDef target fill:#C8E6C9,stroke:#2E7D32,stroke-width:1.5px,color:#000
    classDef report fill:#F3E5F5,stroke:#6A1B9A,stroke-width:1.5px,color:#000

    Author([Pipeline Author<br/>consultant / engineer]):::person

    subgraph Inputs[Inputs]
      YAML[/Pipeline YAML<br/>config/]:::input
      Lookups[/Lookup CSVs<br/>& SQL/]:::input
      Env[/.env credentials/]:::input
    end

    subgraph Sluice[Sluice Toolkit]
      CLI{{sluice CLI}}:::core
      Runner[[PipelineRunner]]:::core
      DuckDB[(DuckDB<br/>staging)]:::core
      Enrich[[sluice-enrich<br/>private, optional]]:::core
    end

    subgraph Sources[Legacy Sources]
      MSSQL[(MSSQL)]
      PG[(PostgreSQL)]
      CSV[CSV / XLSX]
      REST[REST APIs]
      JSON[JSON files]
      Odoo[Odoo CSV exports]
    end

    subgraph Targets[Target ERPs & Files]
      BC[Business Central<br/>REST]:::target
      IFS[IFS ERP<br/>CSV import]:::target
      BlueCherry[BlueCherry ERP<br/>CSV import]:::target
      GenericCsv[Generic CSV / PG]:::target
    end

    subgraph Outputs[Run Artifacts]
      Rejections[/Rejection CSV/]:::report
      Summary[/DQ summary JSON/]:::report
      PrepSum[/Prep summary JSON/]:::report
      State[/Run state JSON/]:::report
      Log[/pino JSON log/]:::report
    end

    Author --> YAML
    Author --> Lookups
    Author --> Env

    YAML --> CLI
    Env --> CLI
    CLI --> Runner

    Sources --> Runner
    Lookups --> Runner
    Runner <--> DuckDB
    Runner -.optional phase.-> Enrich
    Enrich <--> DuckDB
    Runner --> Targets

    Runner --> Rejections
    Runner --> Summary
    Runner --> PrepSum
    Runner --> State
    Runner --> Log
```

---

## 2. Component architecture

Module dependencies inside `src/`. Arrows point toward the dependency.

```mermaid
flowchart TB
    classDef entry fill:#FFCDD2,stroke:#C62828,stroke-width:2px,color:#000
    classDef engine fill:#BBDEFB,stroke:#1565C0,stroke-width:1.5px,color:#000
    classDef adapter fill:#C8E6C9,stroke:#2E7D32,stroke-width:1.5px,color:#000
    classDef infra fill:#E1BEE7,stroke:#6A1B9A,stroke-width:1.5px,color:#000
    classDef utils fill:#FFF9C4,stroke:#F9A825,stroke-width:1.2px,color:#000

    CLI[src/cli.ts]:::entry
    Runner[src/runner.ts<br/>PipelineRunner]:::entry
    MSRunner[MultiSourcePipelineRunner]:::entry

    subgraph Config[src/config]
      Schema[schema.ts<br/>Zod]
      Loader[loader.ts<br/>YAML + env interp]
    end

    subgraph Adapters[src/adapters]
      SrcReg[source/index.ts<br/>Registry]:::adapter
      TgtReg[target/index.ts<br/>Registry]:::adapter
      MSSQL[mssql / pg]:::adapter
      CSV[csv / xlsx]:::adapter
      REST[rest]:::adapter
      JsonSrc[json]:::adapter
      OdooSrc[odoo-csv]:::adapter
      BC[bc]:::adapter
      IFS[ifs]:::adapter
      BlueCherry[bluecherry]:::adapter
      CsvTgt[csv]:::adapter
      PgTgt[pg]:::adapter
    end

    subgraph Engines[engines]
      DQ[src/dq<br/>DQEngine + Rules]:::engine
      Transform[src/transform<br/>TransformEngine]:::engine
      Merge[src/merge<br/>MergeEngine]:::engine
      Prep[src/prep<br/>PrepEngine<br/>+ PrepLookupResolver]:::engine
      Expr[expression.ts<br/>expr-eval-fork + vm]:::engine
    end

    subgraph Ext[extension points]
      Plugins[src/plugins<br/>loader + registries]:::infra
      EnrichT[src/enrich/types.ts<br/>types only — impl is the<br/>private sluice-enrich pkg]:::infra
    end

    subgraph Staging[src/staging]
      Store[store.ts<br/>StagingStore]:::infra
      SSchema[schema.ts]:::infra
    end

    subgraph Utils[src/utils]
      Logger[logger.ts<br/>pino]:::utils
      EnvMod[env.ts]:::utils
      Errors[errors.ts]:::utils
    end

    CLI --> Runner
    CLI --> MSRunner
    CLI --> Loader

    MSRunner --> Runner
    Runner --> SrcReg
    Runner --> TgtReg
    Runner --> Prep
    Runner --> EnrichT
    Runner --> DQ
    Runner --> Transform
    Runner --> Plugins
    MSRunner --> Merge
    Runner --> Store

    Loader --> Schema
    SrcReg --> MSSQL
    SrcReg --> CSV
    SrcReg --> REST
    SrcReg --> JsonSrc
    SrcReg --> OdooSrc
    TgtReg --> BC
    TgtReg --> IFS
    TgtReg --> BlueCherry
    TgtReg --> CsvTgt
    TgtReg --> PgTgt

    DQ --> Store
    Transform --> Store
    Transform --> Expr
    Merge --> Store
    Prep --> Store
    Prep --> Expr
    Plugins --> DQ
    Plugins --> Transform
    Plugins --> Merge

    MSSQL -.-> Store
    CSV -.-> Store
    REST -.-> Store
    BC -.-> Store
    IFS -.-> Store
    BlueCherry -.-> Store
    CsvTgt -.-> Store
    PgTgt -.-> Store

    Runner --> Errors
    Runner --> Logger
    Loader --> EnvMod
    DQ --> Errors
    Transform --> Errors
```

---

## 3. Single-source runtime (sequence)

Phase ordering as implemented in `PipelineRunner.run()`. **Enrich runs between
Prep and DQ** — see the ordering table in §0.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant CLI as sluice CLI
    participant Run as PipelineRunner
    participant Cfg as ConfigLoader
    participant Src as SourceAdapter
    participant Duck as DuckDB (StagingStore)
    participant Prep as PrepEngine
    participant Enr as EnrichPhase (private pkg)
    participant DQ as DQEngine
    participant Tx as TransformEngine
    participant Tgt as TargetAdapter
    participant FS as Filesystem

    User->>CLI: sluice run pipeline.yaml
    CLI->>Cfg: load(path)
    Cfg->>Cfg: resolve ${ENV_VAR}
    Cfg->>Cfg: Zod validate
    Cfg-->>CLI: Pipeline
    CLI->>Run: new + run()

    Run->>Duck: open()
    Run->>Src: connect(config)
    Run->>Src: extract(store, 'stg_raw')
    Src->>Duck: createTable + insertBatch*
    Src-->>Run: ExtractResult
    Run->>Src: disconnect()

    opt prep: block configured and --no-prep not set
        Run->>Prep: run('stg_raw', prep, undefined, runCfg)
        Prep->>Duck: query + DROP + CREATE OR REPLACE + insertBatch
        Prep-->>Run: PrepFiringResult
        Run->>FS: write {name}-prep-summary.json
    end

    opt enrich: block configured, package installed, not dry/validate, --no-enrich not set
        Run->>Enr: run()
        Enr->>Duck: resolve lookups + write enriched columns
        Enr-->>Run: EnrichSummary
    end

    Run->>DQ: validate('stg_raw')
    DQ->>Duck: query
    DQ->>FS: write rejection CSV + summary JSON
    alt critical & stopOnCritical
        DQ-->>Run: throw PipelineDQError
        Run->>FS: write state (failed)
        Run-->>CLI: exit 2
    end

    opt any rows rejected
        Run->>Duck: CREATE stg_raw_accepted (accepted rows only)
        Note over Run,Duck: original stg_raw is left intact for inspection
    end

    Run->>Tx: resolveLookups()
    Tx->>Duck: load lookup sources
    Run->>Tx: transform(accepted table → 'stg_transformed')

    alt dryRun OR validate-only
        Run->>FS: write state + summary
        Run-->>CLI: exit 0
    else full run
        Run->>Tgt: connect(config)
        Run->>Tgt: load('stg_transformed')
        Tgt->>Duck: stream rows
        Tgt-->>Run: LoadResult
        Run->>Tgt: disconnect()
        Run->>FS: write state JSON
        Run->>Duck: close()
        Run-->>CLI: exit 0
    end
```

---

## 4. Multi-source merge flow

Pipeline with `sources[]` + `merge:`. Runner is
`MultiSourcePipelineRunner`.

Note the **two** prep firings and **two** DQ passes: source-scoped rules run
before the merge, unscoped rules after it. Enrich runs once, post-merge.

```mermaid
flowchart TB
    classDef phase fill:#E3F2FD,stroke:#1565C0,stroke-width:1.5px,color:#000
    classDef stage fill:#FFF9C4,stroke:#F9A825,stroke-width:1.5px,color:#000
    classDef decision fill:#FFE0B2,stroke:#E65100,stroke-width:1.5px,color:#000
    classDef output fill:#F3E5F5,stroke:#6A1B9A,stroke-width:1.5px,color:#000

    A[Load & validate YAML<br/>Zod refine: sources XOR source]:::phase
    B[Load plugins<br/>file + sluice.config.yaml]:::phase
    C[Open DuckDB]:::phase

    subgraph PerSource[Per-source extract + prep + DQ - priority-ordered]
      direction TB
      S1[Extract source 1]:::phase --> R1[renameColumns] --> F1{incremental?}:::decision
      F1 -- yes & matches<br/>incrementalSource --> I1[filter by<br/>incrementalField] --> P1[🧽 Prep pre-merge<br/>rules where sourceId = s1]:::phase
      F1 -- no --> P1
      P1 --> D1[DQ rules<br/>where sourceId = s1]:::phase
      D1 --> RW1[stg_raw_s1_accepted<br/>materialised if any row rejected;<br/>stg_raw_s1 left intact]:::stage

      S2[Extract source 2]:::phase --> R2[renameColumns] --> P2[🧽 Prep<br/>where sourceId = s2]:::phase --> D2[DQ rules<br/>where sourceId = s2]:::phase --> RW2[stg_raw_s2_accepted]:::stage
      SN[Extract source N]:::phase --> RN[renameColumns] --> PN[🧽 Prep<br/>where sourceId = sN]:::phase --> DN[DQ rules<br/>where sourceId = sN]:::phase --> RWN[stg_raw_sN_accepted]:::stage
    end

    M[[MergeEngine<br/>strategy: coalesce / priority-override / union / intersect]]:::phase
    MJ[(stg_merge_joined)]:::stage
    MG[(stg_merged)]:::stage
    MC[(stg_merge_conflicts)]:::stage
    CLog[/conflictLog CSV<br/>if configured/]:::output

    PMP[🧽 Prep post-merge<br/>rules with no sourceId]:::phase
    PSum[/prep-summary.json<br/>aggregates all firings/]:::output
    ENR[✨ Enrich post-merge<br/>private sluice-enrich<br/>skipped if absent]:::phase
    PMDQ[Post-merge DQ<br/>rules with no sourceId]:::phase
    TX[Transform<br/>stg_merged → stg_transformed]:::phase
    LD[Load to target]:::phase
    ST[/State file with<br/>per-source sources block/]:::output
    CL[Close DuckDB]:::phase

    A --> B --> C --> PerSource
    RW1 --> M
    RW2 --> M
    RWN --> M
    M --> MJ --> MG
    M --> MC --> CLog
    MG --> PMP --> PSum
    PMP --> ENR --> PMDQ --> TX --> LD --> ST --> CL
```

**Merge strategies at a glance:**

```mermaid
flowchart LR
    classDef s fill:#BBDEFB,stroke:#1565C0,color:#000

    subgraph Coalesce[coalesce]
      CA[priority 1: null<br/>priority 2: Alice<br/>priority 3: Alicia]:::s --> CR[Alice]:::s
    end
    subgraph PO[priority-override]
      PA[priority 1: null<br/>priority 2: Alice<br/>priority 3: Alicia]:::s --> PR[null]:::s
    end
    subgraph Union[union]
      UA[A: 100 keys<br/>B: 120 keys<br/>overlap 80]:::s --> UR[140 rows<br/>deduped by key]:::s
    end
    subgraph Intersect[intersect]
      IA[A: 100 keys<br/>B: 120 keys<br/>overlap 80]:::s --> IR[80 rows]:::s
    end
```

---

## 5. DQ engine — rule evaluation and severity routing

```mermaid
flowchart TB
    classDef rule fill:#FFCCBC,stroke:#D84315,stroke-width:1.5px,color:#000
    classDef sev fill:#FFF59D,stroke:#F9A825,stroke-width:1.5px,color:#000
    classDef out fill:#F3E5F5,stroke:#6A1B9A,stroke-width:1.5px,color:#000

    Row[Row from stg_raw]
    RowLoop{For each<br/>dq.rules}
    Check{For each<br/>rule.checks}

    subgraph Rules[Built-in rules - src/dq/rules]
      direction LR
      N[notNull]:::rule
      U[unique]:::rule
      P[pattern]:::rule
      E[email]:::rule
      UK[ukPostcode]:::rule
      ML[maxLength]:::rule
      MM[min / max]:::rule
      AV[allowedValues]:::rule
    end

    Eval[Rule.validate<br/>returns RuleViolation or null]
    Sev{severity?}:::sev

    Crit[critical:<br/>add violation<br/>mark row rejected]:::sev
    Warn[warning:<br/>add violation<br/>keep row]:::sev
    Info[info:<br/>summary only]:::sev

    RejCsv[/rejection CSV<br/>row_index, field, value,<br/>rule, severity, message/]:::out
    SumJson[/dq-summary.json<br/>counts by field & severity/]:::out
    Halt{stopOnCritical<br/>AND criticalCount > 0?}:::sev
    Throw[throw PipelineDQError<br/>exit code 2]:::out
    Continue[continue to<br/>Transform phase]

    Row --> RowLoop --> Check --> Rules --> Eval --> Sev
    Sev -- critical --> Crit --> RejCsv
    Sev -- warning --> Warn --> RejCsv
    Sev -- info --> Info --> SumJson
    Crit --> SumJson
    Warn --> SumJson
    SumJson --> Halt
    Halt -- yes --> Throw
    Halt -- no --> Continue
```

---

## 6. Transform engine — field resolution

How a single `FieldMapping` resolves to an output column value.

```mermaid
flowchart TB
    classDef io fill:#E3F2FD,stroke:#1565C0,color:#000
    classDef branch fill:#FFE0B2,stroke:#E65100,color:#000
    classDef op fill:#C8E6C9,stroke:#2E7D32,color:#000
    classDef err fill:#FFCDD2,stroke:#C62828,color:#000

    In[/FieldMapping + source row/]:::io
    Type{type?}:::branch

    Str[String value,<br/>cleanse chain,<br/>truncate to max]:::op
    Num[Math.round Number v<br/>NaN → TransformError]:::op
    Dec[parseFloat.toFixed<br/>precision]:::op
    Bool[lowercase match<br/>1 / true / yes / y / t]:::op
    Date[dayjs parse with format,<br/>format as dateFormat]:::op
    Lookup[LookupResolver.resolve<br/>named map]:::op
    Lookup2{hit?}:::branch
    Concat["Join from s1 with<br/>separator, then cleanse"]:::op
    Const[Emit value verbatim]:::op
    Expr[ExpressionEvaluator]:::op
    ExprPrefix{starts with<br/>js:?}:::branch
    SafeEval[expr-eval Parser<br/>row context]:::op
    VmEval[vm.runInNewContext<br/>warn logged]:::op
    Custom["Plugin.apply row, options<br/>via customOp + options"]:::op

    Default[use default]:::op
    NullOut[emit null]:::op
    Err[throw TransformError]:::err
    Out[/output cell<br/>written to stg_transformed/]:::io

    In --> Type
    Type -- string --> Str --> Out
    Type -- number --> Num --> Out
    Type -- decimal --> Dec --> Out
    Type -- boolean --> Bool --> Out
    Type -- date --> Date --> Out
    Type -- concat --> Concat --> Out
    Type -- constant --> Const --> Out
    Type -- lookup --> Lookup --> Lookup2
    Lookup2 -- yes --> Out
    Lookup2 -- no & default --> Default --> Out
    Lookup2 -- no & optional --> NullOut --> Out
    Lookup2 -- no & required --> Err
    Type -- expression --> Expr --> ExprPrefix
    ExprPrefix -- no --> SafeEval --> Out
    ExprPrefix -- yes --> VmEval --> Out
    Type -- custom --> Custom --> Out
```

**Cleanse pipe chain** (left-to-right):

```mermaid
flowchart LR
    classDef c fill:#DCEDC8,stroke:#558B2F,color:#000

    Raw["  John Smith  "] --> T[trim]:::c --> TC[titleCase]:::c --> TR[truncate:20]:::c --> Final["John Smith"]
```

---

## 7. Plugin / extension architecture

Three tiers of extension, all flowing through a single loader into
registry-backed engines.

```mermaid
flowchart LR
    classDef t1 fill:#FFECB3,stroke:#FF8F00,color:#000
    classDef t2 fill:#B2DFDB,stroke:#00695C,color:#000
    classDef t3 fill:#D1C4E9,stroke:#4527A0,color:#000
    classDef loader fill:#1565C0,stroke:#0D47A1,color:#FFF
    classDef reg fill:#FFF59D,stroke:#F9A825,color:#000
    classDef eng fill:#C8E6C9,stroke:#2E7D32,color:#000

    subgraph T1[Tier 1 — Composite rules]
      CR[shared rules.yaml<br/>expanded to built-ins<br/>before Zod validation]:::t1
    end

    subgraph T2[Tier 2 — File plugins]
      RP[*.rule.ts]:::t2
      TP[*.transform.ts]:::t2
      MP[*.merge.ts]:::t2
    end

    subgraph T3[Tier 3 — npm packages]
      NP["sluice.config.yaml<br/>plugins: [@org/pkg]"]:::t3
    end

    Loader[Plugin Loader<br/>--plugins dir... CLI flag]:::loader

    RuleReg[RuleRegistry]:::reg
    TxReg[TransformRegistry]:::reg
    MergeReg[MergeStrategyRegistry]:::reg

    DQE[DQEngine]:::eng
    TXE[TransformEngine]:::eng
    MGE[MergeEngine]:::eng

    YAMLCfg[Pipeline YAML<br/>dq.rulesFile / type: custom / merge.strategy]

    CR --> Loader
    RP --> Loader
    TP --> Loader
    MP --> Loader
    NP --> Loader

    Loader --> RuleReg --> DQE
    Loader --> TxReg --> TXE
    Loader --> MergeReg --> MGE

    YAMLCfg -.-> DQE
    YAMLCfg -.-> TXE
    YAMLCfg -.-> MGE
```

---

## 8. Staging tables — lifecycle in DuckDB

Names are canonical; runner code refers to them as string literals.

```mermaid
flowchart LR
    classDef t fill:#FFF9C4,stroke:#F9A825,color:#000
    classDef drop fill:#FFCDD2,stroke:#C62828,color:#000,stroke-dasharray: 5 3

    subgraph Single[Single-source pipeline]
      direction LR
      R1[(stg_raw)]:::t --> A1[(stg_raw_accepted<br/>only if rows rejected)]:::t --> X1[(stg_transformed)]:::t
      R1 -.no rejections: passes straight through.-> X1
    end

    subgraph Multi[Multi-source pipeline]
      direction LR
      RA[(stg_raw_source1<br/>+ _accepted)]:::t
      RB[(stg_raw_source2<br/>+ _accepted)]:::t
      RC[(stg_raw_sourceN<br/>+ _accepted)]:::t
      J[(stg_merge_joined)]:::t
      M[(stg_merged)]:::t
      MA[(stg_merged_accepted)]:::t
      C[(stg_merge_conflicts)]:::t
      XT[(stg_transformed)]:::t

      RA --> J
      RB --> J
      RC --> J
      J --> M
      J --> C
      M --> MA --> XT
    end

    subgraph Lookups[Lookups - each in its own throwaway :memory: store]
      L1[(stg_lookup<br/>transform.lookups)]:::t
      L2[(stg_prep_lookup<br/>prep.lookups)]:::t
    end
```

**Persistence:**

- Default DuckDB path: `{outputDir}/{pipelineName}.duckdb`
- `run.stagingDb: ':memory:'` → in-process only (used by tests, dryRun)
- Tables are **not** dropped between phases — state is inspectable after a run
- A fresh run truncates / recreates `stg_*` tables at the start of each phase
- **DQ never deletes rejected rows.** When a run has rejections it materialises
  `{table}_accepted` and hands that to Transform, leaving the original table
  whole so a failed run can be inspected. With no rejections the table is passed
  straight through and no `_accepted` table is created — do not write a query
  that assumes one exists
- **Lookup tables are not in the pipeline's staging database at all.** Each
  lookup is resolved in its own throwaway `:memory:` `StagingStore` under a
  fixed table name — `stg_lookup` for `transform.lookups`, `stg_prep_lookup`
  for `prep.lookups` — reduced to a `Map` and cached in-process. You will not
  find these tables in `{pipelineName}.duckdb` after a run, and the two caches
  are deliberately separate (`PrepLookupResolver` vs `LookupResolver`)

---

## 9. Incremental mode & state file

```mermaid
stateDiagram-v2
    direction LR
    [*] --> CheckMode : run starts

    CheckMode --> Full : mode=full
    CheckMode --> Validate : mode=validate-only
    CheckMode --> Incremental : mode=incremental

    Incremental --> ReadState : incrementalSince empty
    Incremental --> UseConfig : incrementalSince set
    ReadState --> ApplyFilter : state file found
    ReadState --> ApplyFilter : else use empty (full scan)
    UseConfig --> ApplyFilter

    ApplyFilter --> Extract : WHERE incrementalField >= since

    Full --> Extract
    Validate --> Extract

    Extract --> Prep : prep block set
    Extract --> DQ : no prep
    Prep --> Enrich : enrich block set and installed
    Prep --> DQ : no enrich
    Enrich --> DQ
    DQ --> Transform
    Transform --> Load : full run
    Transform --> Skip : dryRun or validate-only
    Load --> WriteState
    Skip --> WriteState
    WriteState --> [*] : state file updated
```

---

## 10. CLI commands and exit codes

```mermaid
flowchart TB
    classDef cmd fill:#E3F2FD,stroke:#1565C0,color:#000
    classDef ok fill:#C8E6C9,stroke:#2E7D32,color:#000
    classDef warn fill:#FFE0B2,stroke:#E65100,color:#000
    classDef err fill:#FFCDD2,stroke:#C62828,color:#000

    CLI{sluice}

    Run[run pipeline.yaml]:::cmd
    Val[validate pipeline.yaml]:::cmd
    Prof[profile pipeline.yaml]:::cmd
    Chk[check pipeline.yaml]:::cmd
    Plg[plugins]:::cmd
    Mrg[merge list-strategies<br/>merge info &lt;name&gt;]:::cmd

    E0[exit 0<br/>success]:::ok
    E1[exit 1<br/>pipeline error]:::err
    E2[exit 2<br/>DQ critical]:::warn
    E3[exit 3<br/>config error]:::err
    E4[exit 4<br/>enrich error]:::err
    E5[exit 5<br/>prep error]:::err

    CLI --> Run --> E0
    Run --> E1
    Run --> E2
    Run --> E3
    Run --> E4
    Run --> E5
    CLI --> Val --> E0
    Val --> E3
    Val --> E5
    CLI --> Prof --> E0
    CLI --> Chk --> E0
    Chk --> E3
    CLI --> Plg --> E0
    CLI --> Mrg --> E0
```

---

## 11. Error hierarchy

```mermaid
classDiagram
    class Error
    class PipelineError {
      +name: string
      +cause?: unknown
    }
    class ConfigError
    class SourceError
    class StagingError
    class DQError
    class PipelineDQError {
      +criticalCount: number
      +reportPath: string
    }
    class TransformError
    class ExpressionError
    class LoadError
    class EnrichError
    class PrepError

    Error <|-- PipelineError
    PipelineError <|-- ConfigError
    PipelineError <|-- SourceError
    PipelineError <|-- StagingError
    PipelineError <|-- DQError
    PipelineError <|-- TransformError
    PipelineError <|-- LoadError
    PipelineError <|-- EnrichError
    PipelineError <|-- PrepError
    DQError <|-- PipelineDQError
    TransformError <|-- ExpressionError
```

---

## 12. Client deployment topology

Each client runs Sluice as a CLI against its own private config repo. Client
names here are aliases, not real engagements.

```mermaid
flowchart LR
    classDef client fill:#FFE0B2,stroke:#E65100,color:#000
    classDef repo fill:#E1BEE7,stroke:#6A1B9A,color:#000
    classDef erp fill:#C8E6C9,stroke:#2E7D32,color:#000
    classDef pkg fill:#1565C0,stroke:#0D47A1,color:#FFF

    Pkg["@caracal-lynx/sluice<br/>npm package"]:::pkg

    subgraph AcmeEnv[Acme Corp]
      direction TB
      AcmeRepo["clients/acme-corp<br/>private repo<br/>.env + *.pipeline.yaml"]:::repo
      AcmeSrc[(MSSQL LegacyDB)]:::client
      IFS["IFS ERP<br/>CSV import dir"]:::erp
      AcmeRepo -->|sluice run| AcmeSrc
      AcmeRepo --> IFS
    end

    subgraph StyleEnv[Style Co]
      direction TB
      StyleRepo["clients/style-co<br/>private repo<br/>.env + *.pipeline.yaml"]:::repo
      StyleSrc[(MSSQL / CSV exports)]:::client
      BC["BlueCherry ERP<br/>CSV import dir"]:::erp
      StyleRepo -->|sluice run| StyleSrc
      StyleRepo --> BC
    end

    Pkg -.installed via npm.-> AcmeRepo
    Pkg -.installed via npm.-> StyleRepo
```

---

## FigJam / Figma board blueprint

To mirror these diagrams on a whiteboard, create one board with the
following frames (left-to-right, then wrap):

| #   | Frame title                  | Content                     | Connector style    |
| --- | ---------------------------- | --------------------------- | ------------------ |
| 0   | Pipeline Stages Overview     | Diagram 0                   | Top → bottom       |
| 1   | System Context               | Diagram 1                   | Left → right       |
| 2   | Component Architecture       | Diagram 2                   | Top → bottom       |
| 3   | Runtime — Single-Source      | Diagram 3 (sequence)        | Vertical lifelines |
| 4   | Runtime — Multi-Source Merge | Diagram 4 + strategy legend | Top → bottom       |
| 5   | DQ Engine                    | Diagram 5                   | Top → bottom       |
| 6   | Transform Engine             | Diagram 6 + cleanse chain   | Top → bottom       |
| 7   | Plugin Architecture          | Diagram 7                   | Left → right       |
| 8   | Staging Tables               | Diagram 8                   | Left → right       |
| 9   | Incremental & State          | Diagram 9                   | Left → right       |
| 10  | CLI & Exit Codes             | Diagram 10                  | Radial             |
| 11  | Error Hierarchy              | Diagram 11 (class diagram)  | Inheritance arrows |
| 12  | Client Deployments           | Diagram 12                  | Per-client cluster |

**Sticky-note callouts to add alongside the frames:**

- _DuckDB is the single source of truth mid-run — tables persist after the
  run for debugging._
- _Per-source DQ runs **before** merge; post-merge DQ runs **after**. Same
  rule library, different scope._
- _Enrich sits between **Prep and DQ**, not after Transform — enriched columns
  are meant to be validated. Its implementation is the private
  `@caracal-lynx/sluice-enrich`; if that package is absent the phase is skipped
  silently, so an "enrich did nothing" report usually means "not installed"._
- _DQ never deletes a rejected row. It materialises `{table}_accepted` and
  passes that on, so the rejected rows survive in the original table for
  post-mortem._
- _The `${ENV_VAR}` interpolation happens in `ConfigLoader.load()` — the
  CLI is responsible for calling `loadEnv()` first._
- _`type: custom` fields and `dq.rulesFile` references are resolved by the
  plugin loader **before** Zod sees them._
- _Exit code 2 is reserved for DQ-driven failure — CI can distinguish
  data-quality blockers from infrastructure errors._

---

## Rendering tips

- **GitHub:** Mermaid renders natively in `.md` files.
- **VS Code:** install _Markdown Preview Mermaid Support_.
- **Static export:** `npx @mermaid-js/mermaid-cli -i docs/architecture-diagrams.md -o docs/arch.pdf`
- **FigJam:** paste each Mermaid block as a text node beside its frame for
  source-of-truth reference.
- **Check every block parses** before committing a change to this file. From
  `packages/sluice`:

  ```powershell
  # One-off: mermaid-cli renders through puppeteer and needs a headless browser
  pnpm dlx puppeteer browsers install chrome-headless-shell

  # The check itself — prints "✅" per block, non-zero exit on a parse error
  pnpm dlx @mermaid-js/mermaid-cli -i docs/architecture-diagrams.md -o "$env:TEMPrch-check.md"
  Remove-Item .rch-check-*.svg    # it writes one SVG per block into the CWD
  ```

  All 15 blocks pass as of 2026-08-22. Two gotchas the command earns its keep
  on: it writes a numbered `.svg` per diagram into the **current directory**
  (delete them — they are not wanted in the repo), and without the browser
  install it fails with a `Could not find chrome-headless-shell` error rather
  than a syntax complaint.

  Diagram 12 shipped unrenderable for weeks because nothing ran this: node ids
  cannot contain spaces, and a find-and-replace over client names had left
  `Style CoRepo`. GitHub renders a broken block as a small error box that is
  very easy to scroll past.
