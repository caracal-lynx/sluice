# Sluice — Architecture Diagrams

Visual reference for the Sluice ETL toolkit. All diagrams are Mermaid and
render natively in GitHub, VS Code, and most docs portals. A FigJam
blueprint at the bottom mirrors the same structure for whiteboard use.

> *Clean data flows through.*

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
    end

    subgraph Sources[Legacy Sources]
      MSSQL[(MSSQL)]
      PG[(PostgreSQL)]
      CSV[CSV / XLSX]
      REST[REST APIs]
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
    Runner --> Targets

    Runner --> Rejections
    Runner --> Summary
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
      BC[bc]:::adapter
      IFS[ifs]:::adapter
      BlueCherry[bluecherry]:::adapter
    end

    subgraph Engines[engines]
      DQ[src/dq<br/>DQEngine + Rules]:::engine
      Transform[src/transform<br/>TransformEngine]:::engine
      Merge[src/merge<br/>MergeEngine]:::engine
      Expr[expression.ts<br/>expr-eval + vm]:::engine
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
    Runner --> DQ
    Runner --> Transform
    MSRunner --> Merge
    Runner --> Store

    Loader --> Schema
    SrcReg --> MSSQL
    SrcReg --> CSV
    SrcReg --> REST
    TgtReg --> BC
    TgtReg --> IFS
    TgtReg --> BlueCherry

    DQ --> Store
    Transform --> Store
    Transform --> Expr
    Merge --> Store

    MSSQL -.-> Store
    CSV -.-> Store
    REST -.-> Store
    BC -.-> Store
    IFS -.-> Store
    BlueCherry -.-> Store

    Runner --> Errors
    Runner --> Logger
    Loader --> EnvMod
    DQ --> Errors
    Transform --> Errors
```

---

## 3. Single-source runtime (sequence)

Phase ordering as implemented in `PipelineRunner.run()`.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant CLI as sluice CLI
    participant Run as PipelineRunner
    participant Cfg as ConfigLoader
    participant Src as SourceAdapter
    participant Duck as DuckDB (StagingStore)
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

    Run->>DQ: validate('stg_raw')
    DQ->>Duck: query
    DQ->>FS: write rejection CSV + summary JSON
    alt critical & stopOnCritical
        DQ-->>Run: throw PipelineDQError
        Run->>FS: write state (failed)
        Run-->>CLI: exit 2
    end

    Run->>Tx: resolveLookups()
    Tx->>Duck: load lookup sources
    Run->>Tx: transform('stg_raw' → 'stg_transformed')

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

```mermaid
flowchart TB
    classDef phase fill:#E3F2FD,stroke:#1565C0,stroke-width:1.5px,color:#000
    classDef stage fill:#FFF9C4,stroke:#F9A825,stroke-width:1.5px,color:#000
    classDef decision fill:#FFE0B2,stroke:#E65100,stroke-width:1.5px,color:#000
    classDef output fill:#F3E5F5,stroke:#6A1B9A,stroke-width:1.5px,color:#000

    A[Load & validate YAML<br/>Zod refine: sources XOR source]:::phase
    B[Load plugins<br/>file + sluice.config.yaml]:::phase
    C[Open DuckDB]:::phase

    subgraph PerSource[Per-source extract + DQ - priority-ordered]
      direction TB
      S1[Extract source 1]:::phase --> R1[renameColumns] --> F1{incremental?}:::decision
      F1 -- yes & matches<br/>incrementalSource --> I1[filter by<br/>incrementalField] --> D1[DQ rules<br/>where sourceId = s1]:::phase
      F1 -- no --> D1
      D1 --> RW1[rewrite stg_raw_s1<br/>accepted rows only]:::stage

      S2[Extract source 2]:::phase --> R2[renameColumns] --> D2[DQ rules<br/>where sourceId = s2]:::phase --> RW2[rewrite stg_raw_s2]:::stage
      SN[Extract source N]:::phase --> RN[renameColumns] --> DN[DQ rules<br/>where sourceId = sN]:::phase --> RWN[rewrite stg_raw_sN]:::stage
    end

    M[[MergeEngine<br/>strategy: coalesce / priority-override / union / intersect]]:::phase
    MJ[(stg_merge_joined)]:::stage
    MG[(stg_merged)]:::stage
    MC[(stg_merge_conflicts)]:::stage
    CLog[/conflictLog CSV<br/>if configured/]:::output

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
    MG --> PMDQ --> TX --> LD --> ST --> CL
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
      R1[(stg_raw)]:::t --> X1[(stg_transformed)]:::t
    end

    subgraph Multi[Multi-source pipeline]
      direction LR
      RA[(stg_raw_source1)]:::t
      RB[(stg_raw_source2)]:::t
      RC[(stg_raw_sourceN)]:::t
      J[(stg_merge_joined)]:::t
      M[(stg_merged)]:::t
      C[(stg_merge_conflicts)]:::t
      XT[(stg_transformed)]:::t

      RA --> J
      RB --> J
      RC --> J
      J --> M
      J --> C
      M --> XT
    end

    subgraph Lookups[Lookup tables - loaded once, cached in-process]
      L1[(currencyMap)]:::t
      L2[(acctMgrMap)]:::t
    end
```

**Persistence:**

- Default DuckDB path: `{outputDir}/{pipelineName}.duckdb`
- `run.stagingDb: ':memory:'` → in-process only (used by tests, dryRun)
- Tables are **not** dropped between phases — state is inspectable after a run
- A fresh run truncates / recreates `stg_*` tables at the start of each phase

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

    Extract --> DQ
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

    CLI --> Run --> E0
    Run --> E1
    Run --> E2
    Run --> E3
    CLI --> Val --> E0
    Val --> E3
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

    Error <|-- PipelineError
    PipelineError <|-- ConfigError
    PipelineError <|-- SourceError
    PipelineError <|-- StagingError
    PipelineError <|-- DQError
    PipelineError <|-- TransformError
    PipelineError <|-- LoadError
    DQError <|-- PipelineDQError
    TransformError <|-- ExpressionError
```

---

## 12. Client deployment topology

Each client runs Sluice as a CLI against its own private config repo.

```mermaid
flowchart LR
    classDef client fill:#FFE0B2,stroke:#E65100,color:#000
    classDef repo fill:#E1BEE7,stroke:#6A1B9A,color:#000
    classDef erp fill:#C8E6C9,stroke:#2E7D32,color:#000
    classDef pkg fill:#1565C0,stroke:#0D47A1,color:#FFF

    Pkg[@caracal-lynx/sluice<br/>npm package]:::pkg

    subgraph CochranEnv[Cochran Group - Annan]
      direction TB
      CochRepo[clients/cochran<br/>private repo<br/>.env + *.pipeline.yaml]:::repo
      CochSrc[(MSSQL LegacyDB)]:::client
      IFS[IFS ERP<br/>CSV import dir]:::erp
      CochRepo -->|sluice run| CochSrc
      CochRepo --> IFS
    end

    subgraph EribeEnv[Eribé Knitwear]
      direction TB
      EribeRepo[clients/eribe<br/>private repo<br/>.env + *.pipeline.yaml]:::repo
      EribeSrc[(MSSQL / CSV exports)]:::client
      BC[BlueCherry ERP<br/>CSV import dir]:::erp
      EribeRepo -->|sluice run| EribeSrc
      EribeRepo --> BC
    end

    Pkg -.installed via npm.-> CochRepo
    Pkg -.installed via npm.-> EribeRepo
```

---

## FigJam / Figma board blueprint

To mirror these diagrams on a whiteboard, create one board with the
following frames (left-to-right, then wrap):

| # | Frame title | Content | Connector style |
|---|---|---|---|
| 1 | System Context | Diagram 1 | Left → right |
| 2 | Component Architecture | Diagram 2 | Top → bottom |
| 3 | Runtime — Single-Source | Diagram 3 (sequence) | Vertical lifelines |
| 4 | Runtime — Multi-Source Merge | Diagram 4 + strategy legend | Top → bottom |
| 5 | DQ Engine | Diagram 5 | Top → bottom |
| 6 | Transform Engine | Diagram 6 + cleanse chain | Top → bottom |
| 7 | Plugin Architecture | Diagram 7 | Left → right |
| 8 | Staging Tables | Diagram 8 | Left → right |
| 9 | Incremental & State | Diagram 9 | Left → right |
| 10 | CLI & Exit Codes | Diagram 10 | Radial |
| 11 | Error Hierarchy | Diagram 11 (class diagram) | Inheritance arrows |
| 12 | Client Deployments | Diagram 12 | Per-client cluster |

**Sticky-note callouts to add alongside the frames:**

- *DuckDB is the single source of truth mid-run — tables persist after the
  run for debugging.*
- *Per-source DQ runs **before** merge; post-merge DQ runs **after**. Same
  rule library, different scope.*
- *The `${ENV_VAR}` interpolation happens in `ConfigLoader.load()` — the
  CLI is responsible for calling `loadEnv()` first.*
- *`type: custom` fields and `dq.rulesFile` references are resolved by the
  plugin loader **before** Zod sees them.*
- *Exit code 2 is reserved for DQ-driven failure — CI can distinguish
  data-quality blockers from infrastructure errors.*

---

## Rendering tips

- **GitHub:** Mermaid renders natively in `.md` files.
- **VS Code:** install *Markdown Preview Mermaid Support*.
- **Static export:** `npx @mermaid-js/mermaid-cli -i docs/architecture-diagrams.md -o docs/arch.pdf`
- **FigJam:** paste each Mermaid block as a text node beside its frame for
  source-of-truth reference.
