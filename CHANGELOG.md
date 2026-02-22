### Changelog

All notable changes to this project will be documented in this file. Dates are displayed in UTC.

#### [0.2.4](https://github.com/karmaniverous/jeeves-watcher/compare/0.2.3...0.2.4)

- feat: graceful error handling with BOM stripping, system health tracking, and exponential backoff [`#12`](https://github.com/karmaniverous/jeeves-watcher/pull/12)
- feat: graceful error handling with BOM stripping, system health tracking, and exponential backoff (#11) [`ad01be1`](https://github.com/karmaniverous/jeeves-watcher/commit/ad01be1d3115a0643f211ed4429c9b0530396b3f)
- chore: lint fixes and regenerate config schema (#11) [`eb5d57b`](https://github.com/karmaniverous/jeeves-watcher/commit/eb5d57b9dbcf6494ba520a557e83d380041e10ee)
- docs: add JSDoc to JeevesWatcher class (#11) [`c3825fc`](https://github.com/karmaniverous/jeeves-watcher/commit/c3825fcbbad7a5c5f5506668686e062e4399dee2)
- updated diagrams [`22eaf09`](https://github.com/karmaniverous/jeeves-watcher/commit/22eaf09d499c15c4734c1b129c62f67d87a8ba19)

#### [0.2.3](https://github.com/karmaniverous/jeeves-watcher/compare/0.2.2...0.2.3)

> 21 February 2026

- docs: document env var pass-through behavior [`#10`](https://github.com/karmaniverous/jeeves-watcher/pull/10)
- fix: leave unresolvable env var expressions untouched in config [`#9`](https://github.com/karmaniverous/jeeves-watcher/pull/9)
- [ISSUE-8] fix: leave unresolvable env var expressions untouched in config (closes #8) [`#8`](https://github.com/karmaniverous/jeeves-watcher/issues/8)
- chore: release v0.2.3 [`d7d9a90`](https://github.com/karmaniverous/jeeves-watcher/commit/d7d9a905ba8c74433f8e3de69fdbae89a836ac57)
- [ISSUE-8] docs: document env var pass-through behavior in README [`ca379f3`](https://github.com/karmaniverous/jeeves-watcher/commit/ca379f32aabc2ca6acab8b87033e2126aa69be89)

#### [0.2.2](https://github.com/karmaniverous/jeeves-watcher/compare/0.2.1...0.2.2)

> 21 February 2026

- fix: resolve issues #4 and #5 [`#7`](https://github.com/karmaniverous/jeeves-watcher/pull/7)
- chore: release v0.2.2 [`3d07303`](https://github.com/karmaniverous/jeeves-watcher/commit/3d07303226b3c04a520556d2ad65ff16d2f251c5)
- [ISSUES-4] fix: improve error serialization for pino logging [`021d18c`](https://github.com/karmaniverous/jeeves-watcher/commit/021d18c84d421b978c04478ccd0167e87c603c27)
- [ISSUES-4] feat: implement ${ENV_VAR} substitution in config strings [`5bbb09f`](https://github.com/karmaniverous/jeeves-watcher/commit/5bbb09fad11c10341e742a06b0d228f34b4ec1de)
- lint:fix [`b6446c5`](https://github.com/karmaniverous/jeeves-watcher/commit/b6446c5ab3692bbaa450a9c5c5e5d79057be59ac)
- [ISSUES-4] fix: skip frontmatter parsing when markdown doesn't start with --- [`468c71a`](https://github.com/karmaniverous/jeeves-watcher/commit/468c71a047abe477af1ab023850a0ce5030d5178)

#### [0.2.1](https://github.com/karmaniverous/jeeves-watcher/compare/0.2.0...0.2.1)

> 21 February 2026

- feat: schema-first config with Zod + JsonMap, SOLID/DRY refactor [`#6`](https://github.com/karmaniverous/jeeves-watcher/pull/6)
- refactor: decompose rules module into focused submodules (ajvSetup, attributes, compile, templates, apply) [`5fc1fe8`](https://github.com/karmaniverous/jeeves-watcher/commit/5fc1fe80a46eb640f742c16a4567b22761b78cc3)
- chore: release v0.2.1 [`1f9b997`](https://github.com/karmaniverous/jeeves-watcher/commit/1f9b9979b4596b539f4d29b5ab94223c5156da80)
- refactor: extract API route handlers into api/handlers with narrow deps [`058d6f3`](https://github.com/karmaniverous/jeeves-watcher/commit/058d6f30597501c5fcac4063621ba780b0f8e85a)
- refactor: extract shared utilities (normalizePath, errors, logger, constants, CLI defaults) [`880e9a2`](https://github.com/karmaniverous/jeeves-watcher/commit/880e9a2cdcdce83d43e5950398f447064937308c)
- refactor: decompose JeevesWatcher with ConfigWatcher + injectable factories [`ee92af5`](https://github.com/karmaniverous/jeeves-watcher/commit/ee92af53b2867a7edb5b2ff5939b4a718e6f5b9d)
- refactor: DRY CLI API commands via shared runApiCommand + formatResponse [`cb71522`](https://github.com/karmaniverous/jeeves-watcher/commit/cb71522eee05089f0df559b4067fa387871c53bb)
- docs: add TSDoc to exported RuleLogger and JeevesWatcherFactories members [`1bc80c7`](https://github.com/karmaniverous/jeeves-watcher/commit/1bc80c7766067846065d4ba786080f144ee8463b)
- refactor: remove unused errors utility [`e826dfd`](https://github.com/karmaniverous/jeeves-watcher/commit/e826dfd1bb7f5aeb075a6c158b6b4e68aa8ae336)

#### [0.2.0](https://github.com/karmaniverous/jeeves-watcher/compare/0.1.0...0.2.0)

> 21 February 2026

- feat: schema-first config (Zod 4), JsonMap integration, DRY/SOLID refactor [`#3`](https://github.com/karmaniverous/jeeves-watcher/pull/3)
- chore: release v0.2.0 [`f0d1ce2`](https://github.com/karmaniverous/jeeves-watcher/commit/f0d1ce260f48cc9c0ab5cb25098d52a498f44408)
- fix: resolve typedoc warnings, export schemas, update deps, add logging [`9b75e80`](https://github.com/karmaniverous/jeeves-watcher/commit/9b75e808750f0fa7238557b45c702b57784a5c47)
- feat: add Zod schema descriptions [`531939f`](https://github.com/karmaniverous/jeeves-watcher/commit/531939fbe3c6f80e25df9ed36ad9d048618edcc8)
- refactor: DRY API routes and CLI commands [`1b8cb4f`](https://github.com/karmaniverous/jeeves-watcher/commit/1b8cb4f1b6ac9ac6f05ae202c8fdb07dfa695de4)
- docs: add PlantUML architecture diagrams and embed in documentation [`79daf6b`](https://github.com/karmaniverous/jeeves-watcher/commit/79daf6b8f79af03be9e9f3cb175fbf3478447abb)
- test: add CLI command tests (status, search, reindex, configReindex, rebuildMetadata, service) [`094c333`](https://github.com/karmaniverous/jeeves-watcher/commit/094c333bc20b4961f8cd15a7a9ea3f77c2cc9d14)
- feat: schema-first config with Zod 4 [`fd8987b`](https://github.com/karmaniverous/jeeves-watcher/commit/fd8987b4796e62d28e40b0cca4c80f465ed43954)
- feat: generate config JSON schema and standardize defaults [`d56659f`](https://github.com/karmaniverous/jeeves-watcher/commit/d56659f72f293e7b3b8ac3094f3163a91648d182)
- refactor: decompose DocumentProcessor (SRP) [`99db65f`](https://github.com/karmaniverous/jeeves-watcher/commit/99db65f8b590a92688de2ba60fa64000ceee3f47)
- feat: execute jsonmap in inference rules [`2f48426`](https://github.com/karmaniverous/jeeves-watcher/commit/2f484267a4deec45dcfc8700735f91b7ac6343a2)
- docs: document jsonmap maps and regenerate schema [`a6db501`](https://github.com/karmaniverous/jeeves-watcher/commit/a6db501b8316340db12d6fe9f61127675ea140c1)
- test: add integration error-path coverage (skip if qdrant down) [`fb4e646`](https://github.com/karmaniverous/jeeves-watcher/commit/fb4e646086409fb5b69145991ed1047e3507ce61)
- refactor: extractor and embedding provider registries (OCP) [`9fbf9e3`](https://github.com/karmaniverous/jeeves-watcher/commit/9fbf9e3fdd0d275b5ccaf0015d1c0bd108c33c3c)
- fix: replace console.warn with pino logger in retry logic [`63a9888`](https://github.com/karmaniverous/jeeves-watcher/commit/63a9888e4c3f2363a038954ca502cb2ce96ab67e)
- rendered diagrams [`ecdef44`](https://github.com/karmaniverous/jeeves-watcher/commit/ecdef44a7f7082064f36f562bfff81a34bdc7f17)
- merge: resolve package-lock conflict with main [`a358b80`](https://github.com/karmaniverous/jeeves-watcher/commit/a358b808836c254ba6eb362fc6f99a417082aa0d)
- docs: fix all documentation gaps and inaccuracies [`1c7128d`](https://github.com/karmaniverous/jeeves-watcher/commit/1c7128d39fb0ce509968487eb5343c5c51ea3bb4)
- test: add config loading and schema validation edge cases [`878a888`](https://github.com/karmaniverous/jeeves-watcher/commit/878a888053e1460660b21ff2a52c97414cfa99fa)
- feat: centralize config defaults [`4310e75`](https://github.com/karmaniverous/jeeves-watcher/commit/4310e7588d4c4a49b1513e0288c51dd321cba030)
- feat: implement enrich CLI command [`1abda09`](https://github.com/karmaniverous/jeeves-watcher/commit/1abda0918bece26c61aa4f6f3758fa0df78f6353)
- test: cover rules engine edge cases [`e631e48`](https://github.com/karmaniverous/jeeves-watcher/commit/e631e48ca9229c1025ad21f627318c7a69f4a1e2)
- feat: add @module TSDoc, checkCompatibility, mark enrich as planned [`d3aae8a`](https://github.com/karmaniverous/jeeves-watcher/commit/d3aae8a3d90d277cf51299ff300b80c38fa048ad)
- refactor: narrow processor interface (ISP) + misc cleanup [`975daf1`](https://github.com/karmaniverous/jeeves-watcher/commit/975daf1ded93dc407acf1de3f47c7b57b7b66100)
- feat: add jsonmap to config schema (maps + map on rules) [`5e70229`](https://github.com/karmaniverous/jeeves-watcher/commit/5e702298a702be8045856af417f54d83a34a3c2f)
- refactor: replace hand-rolled utilities with radash (get) [`ae1e537`](https://github.com/karmaniverous/jeeves-watcher/commit/ae1e537b6ed763545e8a7c09ddddccc1d47e4965)
- fix: align diagram paths with .vscode/settings.json conventions [`9430b98`](https://github.com/karmaniverous/jeeves-watcher/commit/9430b98ccdf4c0b21cef98fea00c7795ea77f02b)
- updated plantuml settings [`002dbf2`](https://github.com/karmaniverous/jeeves-watcher/commit/002dbf2dcd2cce71829f2b179751bb6befa64cf5)
- docs: remove OpenAI embedding provider (not implemented) [`abf0b9c`](https://github.com/karmaniverous/jeeves-watcher/commit/abf0b9c0c6501dbc8139f745ab16cc107a14b961)
- chore: install radash [`30a456d`](https://github.com/karmaniverous/jeeves-watcher/commit/30a456def10505fa2dec42df5d7ff68db7c78289)
- fix: make rebuild-metadata system keys mutable [`93fbb42`](https://github.com/karmaniverous/jeeves-watcher/commit/93fbb42e11e413e08dab9ba655f416301024d300)
- fix: make queue drain timeout check lint-friendly [`8cd217e`](https://github.com/karmaniverous/jeeves-watcher/commit/8cd217ef7ed1c50a8b1134f12473ed7daf00163a)
- fix: make queue drain timeout check lint-friendly [`7dd8534`](https://github.com/karmaniverous/jeeves-watcher/commit/7dd8534b263f1d7ce24b1994db20b2bbde9c9e30)
- fix: relax search command header assertion to satisfy lint [`82a6a68`](https://github.com/karmaniverous/jeeves-watcher/commit/82a6a68bddf2ec4832725421a3fa79c17dd84f70)
- fix: align buildMergedMetadata logger type with applyRules [`78455eb`](https://github.com/karmaniverous/jeeves-watcher/commit/78455eb06c8c9bf0fc86d958e91ab0fc177cf04f)
- fix: remove unused error variable in enrich command [`cd61437`](https://github.com/karmaniverous/jeeves-watcher/commit/cd61437259b11b55a44919962f1d1d058d32869d)

#### 0.1.0

> 20 February 2026

- Initial commit [`5981aa4`](https://github.com/karmaniverous/jeeves-watcher/commit/5981aa4a62c69e1c87ea5b4c3fda7b8111aa31f2)
- updated docs [`688bb79`](https://github.com/karmaniverous/jeeves-watcher/commit/688bb796b3e89ed81c589946e68a5b3ae0c3b998)
- fix: resolve typedoc cross-reference anchors and add highlight languages [`1a05a39`](https://github.com/karmaniverous/jeeves-watcher/commit/1a05a39e896c5912204b204e2cb35f4cfc5af2c7)
- feat: initial scaffolding for jeeves-watcher [`b2aa733`](https://github.com/karmaniverous/jeeves-watcher/commit/b2aa733558c36ed460404fcebc70648cd07acee5)
- docs: add comprehensive guide pages and update typedoc config [`9c79760`](https://github.com/karmaniverous/jeeves-watcher/commit/9c797601e4ccc974b3f29aa092af47398d1689b3)
- chore: update package.json keywords [`a9147f6`](https://github.com/karmaniverous/jeeves-watcher/commit/a9147f6fdaedad2147ece8d536ed2a818c8869b0)
- chore: release v0.1.0 [`87b4650`](https://github.com/karmaniverous/jeeves-watcher/commit/87b4650ad9ef6399bfa598a3ddbaf1e4acd5ece5)
- updated docs [`d65d32b`](https://github.com/karmaniverous/jeeves-watcher/commit/d65d32bc6618721280b187e78e056ee365064273)
- chore: replace npm-package-template-ts with jeeves-watcher [`d1a8014`](https://github.com/karmaniverous/jeeves-watcher/commit/d1a8014995a53e2a2fb2b907b369c9949312703e)
- updated changelog [`ec215ea`](https://github.com/karmaniverous/jeeves-watcher/commit/ec215ea092fcebc647e773cb4d18afff8ebd3cb2)
- feat: add inference rules engine with glob matching and templated metadata [`0b1a60b`](https://github.com/karmaniverous/jeeves-watcher/commit/0b1a60b282fc767923f8517e46fe80add1dff685)
- chore: regenerate typedoc output [`c751fd6`](https://github.com/karmaniverous/jeeves-watcher/commit/c751fd6044f707c9cd391258c8f00a5e66cd846f)
- feat: add config reindex endpoint and CLI [`b103059`](https://github.com/karmaniverous/jeeves-watcher/commit/b1030594cfc8f1e58dedba0d8b6580ef2c6bf030)
- test: add Qdrant integration tests [`129070f`](https://github.com/karmaniverous/jeeves-watcher/commit/129070f17a320c73ee8b0a82b93164dabd4b005f)
- feat: document processor pipeline [`fc3f239`](https://github.com/karmaniverous/jeeves-watcher/commit/fc3f239627fd854490d202607881ea04c52fe3f2)
- docs: add contributing guide [`549231f`](https://github.com/karmaniverous/jeeves-watcher/commit/549231fa761c400b0fc2991413857174337386f0)
- docs: expand README with comprehensive documentation [`558eb10`](https://github.com/karmaniverous/jeeves-watcher/commit/558eb10fe6de21b1314652e67e487378517df171)
- feat: implement DOCX text extractor [`a0e3eb8`](https://github.com/karmaniverous/jeeves-watcher/commit/a0e3eb8f83d19d73b76c1cc5fcea938b5697921d)
- feat(api): implement reindex and rebuild-metadata [`45a6fd7`](https://github.com/karmaniverous/jeeves-watcher/commit/45a6fd7c9e72a9339a473b615380af6dbebc47d8)
- feat: add JeevesWatcher app entry point and wire CLI commands [`effb2df`](https://github.com/karmaniverous/jeeves-watcher/commit/effb2df6a169d615a2c35ce412824dd0737beda2)
- feat: add logger module, expand config types with defaults and ajv validation [`244a318`](https://github.com/karmaniverous/jeeves-watcher/commit/244a318454ae1b4fa535c0f608ff13e2de166b8d)
- feat: Qdrant vector store client wrapper [`e3b5152`](https://github.com/karmaniverous/jeeves-watcher/commit/e3b51521a286c0094a0bfd1591d5b75b1a04c6ec)
- feat: add debounced rate-limited event queue with concurrency and drain [`19aec40`](https://github.com/karmaniverous/jeeves-watcher/commit/19aec40d8d2b6689a92cc52fd2765f490c28ca6c)
- feat: add text extractors for markdown, plaintext, and json [`521435e`](https://github.com/karmaniverous/jeeves-watcher/commit/521435e45dbdd42846e1c412de71c3bfecc37bb7)
- feat: add content hashing, metadata persistence, and deterministic point IDs [`f8aabe8`](https://github.com/karmaniverous/jeeves-watcher/commit/f8aabe8a29b171df69f2f3dcde02cabb40a923ee)
- test: expand integration tests with full lifecycle, metadata enrichment API, and search endpoint [`4e81704`](https://github.com/karmaniverous/jeeves-watcher/commit/4e817041906c4cdade393f2de4527ff9236e5ab5)
- feat: implement Gemini embedding provider [`88959bb`](https://github.com/karmaniverous/jeeves-watcher/commit/88959bb8127dbdd768dccba9895c72e744b6bbd9)
- feat: add config file watching with debounced reload [`9c27c0e`](https://github.com/karmaniverous/jeeves-watcher/commit/9c27c0e1639779236cb108c48f5f562c184a6733)
- feat: implement PDF text extraction using unpdf [`4ddff5a`](https://github.com/karmaniverous/jeeves-watcher/commit/4ddff5ae9e310f299713934c18244438891f6bc5)
- feat: add FileSystemWatcher module [`29f8875`](https://github.com/karmaniverous/jeeves-watcher/commit/29f887595aff9e680c9203f9b31c37e0aeaad97b)
- feat: add API server module [`7001681`](https://github.com/karmaniverous/jeeves-watcher/commit/70016811f208f6de13ef462cb4bc99150001eb14)
- feat(cli): wire reindex rebuild-metadata and search [`104d35f`](https://github.com/karmaniverous/jeeves-watcher/commit/104d35f7f8211a9aee00a772b6b1db1aa3563435)
- feat: embedding provider abstraction with mock provider [`90b40a5`](https://github.com/karmaniverous/jeeves-watcher/commit/90b40a5d3e33d4f6542c24934ee4fc4781ac4d20)
- feat(cli): add service install/uninstall instructions [`de6c363`](https://github.com/karmaniverous/jeeves-watcher/commit/de6c363d773ece06a0c903a6b7a8a537a90797f8)
- feat(cli): add init command [`dcb7462`](https://github.com/karmaniverous/jeeves-watcher/commit/dcb74625ecbf349be62cea32a79f4ecdd41a9f07)
- feat: implement Gemini embedding provider [`40d46f1`](https://github.com/karmaniverous/jeeves-watcher/commit/40d46f17b6bb39d1e58662d538c218a97ddf2497)
- feat: update public exports with all new modules [`0ef5413`](https://github.com/karmaniverous/jeeves-watcher/commit/0ef5413a20aa9670a62bac8f880d609a13caaaae)
