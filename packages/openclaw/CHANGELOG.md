### Changelog

All notable changes to this project will be documented in this file. Dates are displayed in UTC.

#### [0.3.8](https://github.com/karmaniverous/jeeves-watcher/compare/0.5.1...0.3.8)

- feat(openclaw): --memory flag for install CLI [`#69`](https://github.com/karmaniverous/jeeves-watcher/pull/69)
- feat(openclaw): decouple plugin from watcher config vocabulary [`#68`](https://github.com/karmaniverous/jeeves-watcher/pull/68)
- fix: fresh QdrantClient for write ops to avoid stale keep-alive ECONNRESET [`#67`](https://github.com/karmaniverous/jeeves-watcher/pull/67)
- fix: use domains (plural array) in virtual rules and search filter [`#66`](https://github.com/karmaniverous/jeeves-watcher/pull/66)
- feat: POST /rules/reapply endpoint + plugin auto-reapply after registration [`#65`](https://github.com/karmaniverous/jeeves-watcher/pull/65)
- fix: disable AJV strict mode to suppress schema type warnings [`#55`](https://github.com/karmaniverous/jeeves-watcher/pull/55)
- fix: case-insensitive glob matching in AJV rule keyword [`#64`](https://github.com/karmaniverous/jeeves-watcher/pull/64)
- fix: use glob instead of pattern for virtual rule matching [`#62`](https://github.com/karmaniverous/jeeves-watcher/pull/62)
- fix: normalizePath preserves drive letter case to match service [`#61`](https://github.com/karmaniverous/jeeves-watcher/pull/61)
- fix: ensure text index on startup + re-register virtual rules after watcher restart [`#60`](https://github.com/karmaniverous/jeeves-watcher/pull/60)
- fix: plugin config lookup uses correct entry key (jeeves-watcher-openclaw) [`#59`](https://github.com/karmaniverous/jeeves-watcher/pull/59)
- fix: update test fixture to include slots for idempotency check [`#58`](https://github.com/karmaniverous/jeeves-watcher/pull/58)
- chore: bump @karmaniverous/jsonmap to 2.1.1 [`#57`](https://github.com/karmaniverous/jeeves-watcher/pull/57)
- fix: plugin installer claims memory slot in OpenClaw config [`#56`](https://github.com/karmaniverous/jeeves-watcher/pull/56)
- docs: update guides for v0.6.0 changes [`#54`](https://github.com/karmaniverous/jeeves-watcher/pull/54)
- refactor: extract modules to fix 300 LOC violations [`#53`](https://github.com/karmaniverous/jeeves-watcher/pull/53)
- refactor: DRY fixes and comprehensive test coverage for openclaw package [`#52`](https://github.com/karmaniverous/jeeves-watcher/pull/52)
- refactor+test: service SOLID/DRY fixes + 54 new tests [`#51`](https://github.com/karmaniverous/jeeves-watcher/pull/51)
- feat: memory slot takeover with virtual rules API [`#49`](https://github.com/karmaniverous/jeeves-watcher/pull/49)
- feat: support external rule file references in inferenceRules config [`#50`](https://github.com/karmaniverous/jeeves-watcher/pull/50)
- feat(service): add hybrid search with BM25 text index and RRF fusion [`#48`](https://github.com/karmaniverous/jeeves-watcher/pull/48)
- feat(service): Handlebars set expressions + date normalization [`#47`](https://github.com/karmaniverous/jeeves-watcher/pull/47)
- feat(service): add filesystem date metadata and line offsets [`#46`](https://github.com/karmaniverous/jeeves-watcher/pull/46)
- fix(openclaw): skill review feedback [`#45`](https://github.com/karmaniverous/jeeves-watcher/pull/45)
- chore(openclaw): merge skills, simplify build, improve error messaging [`#44`](https://github.com/karmaniverous/jeeves-watcher/pull/44)
- docs: document self-installer CLI and Windows workaround [`#41`](https://github.com/karmaniverous/jeeves-watcher/pull/41)
- fix: resolve lint errors in openclaw CLI [`#40`](https://github.com/karmaniverous/jeeves-watcher/pull/40)
- feat: add install/uninstall CLI for OpenClaw plugin [`#39`](https://github.com/karmaniverous/jeeves-watcher/pull/39)
- chore: fix monorepo release-it tags, plugin id, and version sync [`#38`](https://github.com/karmaniverous/jeeves-watcher/pull/38)
- feat(service): add hybrid search with BM25 text index and RRF fusion (#48) [`#35`](https://github.com/karmaniverous/jeeves-watcher/issues/35)
- feat(service): add filesystem date metadata and line offsets (#46) [`#24`](https://github.com/karmaniverous/jeeves-watcher/issues/24)
- updated docs [`3028f04`](https://github.com/karmaniverous/jeeves-watcher/commit/3028f04a038935d6339c575f8c78dc10f301a2df)
- chore: release @karmaniverous/jeeves-watcher-openclaw v0.1.0 [`97e2834`](https://github.com/karmaniverous/jeeves-watcher/commit/97e2834986f0ce53098d0299d0da3025a432e43f)
- feat: add install/uninstall CLI to bypass OpenClaw spawn EINVAL bug on Windows [`1ad7fbb`](https://github.com/karmaniverous/jeeves-watcher/commit/1ad7fbb1f4947d852a5a16a2b564b27ccb0620d5)
- docs: fix template syntax, stale references, and add missing API/tool docs [`8af92ef`](https://github.com/karmaniverous/jeeves-watcher/commit/8af92efff989bc78b60fa7ab99020619aa72c5f7)
- fix: resolve eslint unbound-method and prettier errors [`36b5803`](https://github.com/karmaniverous/jeeves-watcher/commit/36b5803e83cce02bcb124095662965f887ceec66)
- fix: resolve lint errors in openclaw CLI and add rollup externals [`b4e8514`](https://github.com/karmaniverous/jeeves-watcher/commit/b4e8514d991daaed99bd7d7dff7028b4310109be)
- fix: add nocase and dot options to AJV glob keyword [`3f7cb9b`](https://github.com/karmaniverous/jeeves-watcher/commit/3f7cb9b34638f0cdfe86057a2a9b5a70cd7e23da)
- docs: document self-installer CLI and Windows spawn EINVAL workaround [`e3d6351`](https://github.com/karmaniverous/jeeves-watcher/commit/e3d63512fe57b555e753c8f86bbfe57a1b97f70c)
- chore: release @karmaniverous/jeeves-watcher v0.6.0 [`b7b207e`](https://github.com/karmaniverous/jeeves-watcher/commit/b7b207e96b1750bcacc4f5dd67ecf9c369415e25)
- lintfix [`cd4c841`](https://github.com/karmaniverous/jeeves-watcher/commit/cd4c84150cfce2b541a9215966139f61e0ce6fcd)
- fix: use fresh QdrantClient for write ops to avoid stale keep-alive connections [`e8215d5`](https://github.com/karmaniverous/jeeves-watcher/commit/e8215d5dc9f82deea59e8259f28be4b2e074f0fb)
- fix: apply same conditional logic to tools.allow as plugins.allow [`4549569`](https://github.com/karmaniverous/jeeves-watcher/commit/4549569ea72e1bbe385fd7592497982bbc34ec39)
- chore: release @karmaniverous/jeeves-watcher-openclaw v0.3.0 [`3ce4950`](https://github.com/karmaniverous/jeeves-watcher/commit/3ce4950d10de13300db94e90247739a3f4a6514a)
- fix: plugin installer now claims memory slot in OpenClaw config [`020c6cd`](https://github.com/karmaniverous/jeeves-watcher/commit/020c6cdd258ad8a6e092e173c88caabf05e5f323)
- fix: remove plugins.allow management from CLI, only manage entries and tools.allow [`64106b4`](https://github.com/karmaniverous/jeeves-watcher/commit/64106b49be35f11c8e4b9a499b45067869decc4b)
- fix: conditionally manage plugins.allow only when already populated [`c486c3a`](https://github.com/karmaniverous/jeeves-watcher/commit/c486c3a8bc12df5f1d233a0f974c0024e91e84b4)
- chore: release @karmaniverous/jeeves-watcher-openclaw v0.2.0 [`a6d4d7e`](https://github.com/karmaniverous/jeeves-watcher/commit/a6d4d7e57424b482b737cb6983dc5c9a86b96160)
- fix(openclaw): use error.cause for precise connection error detection [`3bdd267`](https://github.com/karmaniverous/jeeves-watcher/commit/3bdd267225d129186ee6d9263379ddcd6808d7df)
- chore: release @karmaniverous/jeeves-watcher-openclaw v0.1.2 [`c019f41`](https://github.com/karmaniverous/jeeves-watcher/commit/c019f410d5cef94e653450b82966d64e1a70f900)
- chore: release @karmaniverous/jeeves-watcher-openclaw v0.3.6 [`e864fec`](https://github.com/karmaniverous/jeeves-watcher/commit/e864fecd732f8cd4fedd708ff6a95b31311ad854)
- chore: release @karmaniverous/jeeves-watcher-openclaw v0.1.1 [`008e757`](https://github.com/karmaniverous/jeeves-watcher/commit/008e757704e0cdf5bca7819a9b9eb36b7258a300)
- chore: release @karmaniverous/jeeves-watcher-openclaw v0.3.4 [`5b11938`](https://github.com/karmaniverous/jeeves-watcher/commit/5b119389b8dac493a4cf164e664338804ccd2dc5)
- chore: release @karmaniverous/jeeves-watcher-openclaw v0.3.1 [`de3215a`](https://github.com/karmaniverous/jeeves-watcher/commit/de3215ae4503eece2cb3823c26e6fa00fd1008d1)
- chore: release @karmaniverous/jeeves-watcher v0.6.4 [`b41bfc3`](https://github.com/karmaniverous/jeeves-watcher/commit/b41bfc3905995768f9c881f74518f7a943dcea7e)
- chore: release @karmaniverous/jeeves-watcher v0.6.2 [`fa2304d`](https://github.com/karmaniverous/jeeves-watcher/commit/fa2304db79539f712770f7a958fc30e3b4d46ded)
- chore: release @karmaniverous/jeeves-watcher-openclaw v0.3.5 [`837a941`](https://github.com/karmaniverous/jeeves-watcher/commit/837a94145b086245df101f7dcf2fd7a0c5ebfbca)
- chore: release @karmaniverous/jeeves-watcher v0.6.1 [`037d9c9`](https://github.com/karmaniverous/jeeves-watcher/commit/037d9c924e1bc3020fb6b497f59261dd027718bd)
- chore: release @karmaniverous/jeeves-watcher-openclaw v0.3.7 [`4c12277`](https://github.com/karmaniverous/jeeves-watcher/commit/4c12277cddbfd048f2312f94a907f11ea748407a)
- fix: use glob instead of pattern for virtual rule matching (case-insensitive on Windows) [`0526d5a`](https://github.com/karmaniverous/jeeves-watcher/commit/0526d5a811e243de11e196f6b27b0be3578e2db3)
- chore: release @karmaniverous/jeeves-watcher v0.6.3 [`da7414c`](https://github.com/karmaniverous/jeeves-watcher/commit/da7414c19894031d02da4713e3d57957a9f96449)
- chore: release @karmaniverous/jeeves-watcher-openclaw v0.3.3 [`9db834e`](https://github.com/karmaniverous/jeeves-watcher/commit/9db834ee75686d4a0cad09743d4d96b3d9c41ee5)
- chore: release @karmaniverous/jeeves-watcher-openclaw v0.3.2 [`99be8d8`](https://github.com/karmaniverous/jeeves-watcher/commit/99be8d8c5a895d28cc124c9110dba7e1f49eefc5)
- chore: release @karmaniverous/jeeves-watcher v0.6.5 [`1c5a7fe`](https://github.com/karmaniverous/jeeves-watcher/commit/1c5a7fee4d192ed736b3ea4700df7649b49fd1d6)
- fix: normalizePath preserves drive letter case to match service path normalization [`b79c8c4`](https://github.com/karmaniverous/jeeves-watcher/commit/b79c8c4cee38ccf989a7ee067a67c1879464e53d)
- chore: remove temp commit script [`31d35a7`](https://github.com/karmaniverous/jeeves-watcher/commit/31d35a7341fdfe9d823ffbd04f4192396edcd638)
- package version 0 [`eda1c58`](https://github.com/karmaniverous/jeeves-watcher/commit/eda1c58217fc89a4f1d2ff3e048c13973b5056fd)
- fix: revert unconditional ensureTextIndex from initialization.ts [`7ae6b62`](https://github.com/karmaniverous/jeeves-watcher/commit/7ae6b629352d3b48872186f469694d72132092d5)

#### [0.5.1](https://github.com/karmaniverous/jeeves-watcher/compare/0.5.0...0.5.1)

> 25 February 2026

- feat: convert to monorepo with service and openclaw plugin packages [`#37`](https://github.com/karmaniverous/jeeves-watcher/pull/37)
- chore: fix docs, READMEs, and rollup config for monorepo [`0b92399`](https://github.com/karmaniverous/jeeves-watcher/commit/0b92399eec0275c42ecb6a637c0c59756925c321)
- chore: align release-it config for monorepo [`938a3e0`](https://github.com/karmaniverous/jeeves-watcher/commit/938a3e0deb686f9f224c90f7e585782e072a6e3e)
- chore: make service package ESM-only, remove CJS and IIFE outputs [`9a16492`](https://github.com/karmaniverous/jeeves-watcher/commit/9a164923ae10e7a391520794440aa05420bd99f6)
- chore: convert repo to npm workspaces monorepo [`d8fc6e8`](https://github.com/karmaniverous/jeeves-watcher/commit/d8fc6e821af4dde868f1c82b82f8c348788b4a65)
- docs: add guides index pages for foldable typedoc sections [`1827505`](https://github.com/karmaniverous/jeeves-watcher/commit/1827505522859efbe89895f1b18d4c141c6f76f1)
- chore: release @karmaniverous/jeeves-watcher v0.5.1 [`b11e44e`](https://github.com/karmaniverous/jeeves-watcher/commit/b11e44e08911b12f719bb43357cc7647f3905ac6)
- chore: fix knip after monorepo split [`e16460b`](https://github.com/karmaniverous/jeeves-watcher/commit/e16460b90e5a695818bde2b47ac6577abf6cbf1c)
- added env local template [`74aaa72`](https://github.com/karmaniverous/jeeves-watcher/commit/74aaa726761cb16d3f133a926e0a335b22417808)
- removed docs from release script [`8878235`](https://github.com/karmaniverous/jeeves-watcher/commit/88782358db1a8ff2f1303d503d7086df4994d23b)

#### [0.5.0](https://github.com/karmaniverous/jeeves-watcher/compare/0.5.0-1...0.5.0)

> 25 February 2026

- docs(skill): add theory of operation, remove stale SKILL.md [`#36`](https://github.com/karmaniverous/jeeves-watcher/pull/36)
- feat: v0.5.0 — plugin expansion, two-skill architecture, API extensions [`#35`](https://github.com/karmaniverous/jeeves-watcher/pull/35)
- chore: release v0.5.0 [`aa5a5aa`](https://github.com/karmaniverous/jeeves-watcher/commit/aa5a5aa2ed2f40f581ee28bf9946c1a065c5a9bd)
- docs(skill): add theory of operation narrative, remove stale plugin/skill/SKILL.md [`979993d`](https://github.com/karmaniverous/jeeves-watcher/commit/979993dfbd19a8102441fb95d7be10ae0000c6e5)

#### [0.5.0-1](https://github.com/karmaniverous/jeeves-watcher/compare/0.5.0-0...0.5.0-1)

> 25 February 2026

- docs: export missing symbols, add TSDoc, fix typedoc warnings [`85f5f02`](https://github.com/karmaniverous/jeeves-watcher/commit/85f5f02c84c2ecf309ef799d186d689a5e8412ef)
- chore: release v0.5.0-1 [`2b330da`](https://github.com/karmaniverous/jeeves-watcher/commit/2b330dabb6f630394138a8132e51e49ae6f0cfb2)

#### [0.5.0-0](https://github.com/karmaniverous/jeeves-watcher/compare/0.4.4...0.5.0-0)

> 25 February 2026

- chore: release v0.5.0-0 [`0c181d9`](https://github.com/karmaniverous/jeeves-watcher/commit/0c181d95303c04178aa7cb51a4ffe852354d6f02)
- docs: complete v0.5.0 documentation pass [`e563ee8`](https://github.com/karmaniverous/jeeves-watcher/commit/e563ee870a92229be2fc71fb0fefdd7bbd23dbe7)
- docs: fix TypeDoc warnings — constructor params, JsonFileStore props, handlebars highlight [`388bed4`](https://github.com/karmaniverous/jeeves-watcher/commit/388bed46c1d49360adca7109476d502abb13f007)
- feat(schema): implement Phase 1 - core schema system [`4b538ad`](https://github.com/karmaniverous/jeeves-watcher/commit/4b538ad12dd4f68a093faf7e5460a2cfcc716d84)
- feat: foundation for v0.5.0 - issues, values, named rules, config schema [`a81cfa9`](https://github.com/karmaniverous/jeeves-watcher/commit/a81cfa98f8b16cc3e0559571d6db36dd00a5e440)
- refactor(DRY): split config schemas into logical modules [`fc24cb4`](https://github.com/karmaniverous/jeeves-watcher/commit/fc24cb4ffb306ca8454f3467074be0569ce64ad8)
- feat: API endpoints for v0.5.0 — query validate apply issues reindex tracking [`97b0f75`](https://github.com/karmaniverous/jeeves-watcher/commit/97b0f7516de416c68bb5af95491150cd318680ba)
- feat: validate metadata and align issues + skill docs [`1ffdc0c`](https://github.com/karmaniverous/jeeves-watcher/commit/1ffdc0cfbf56411a060c924e3f3b0918c54b7720)
- feat: helper namespace prefixing and JSDoc introspection [`ffbaba5`](https://github.com/karmaniverous/jeeves-watcher/commit/ffbaba5e7661089566aab452d0c3c3b45d0f494f)
- docs: update guides for v0.5.0 endpoints, config, and CLI [`0c79850`](https://github.com/karmaniverous/jeeves-watcher/commit/0c79850ad5906ce60dec257e502b7bcd83a09de6)
- feat: complete v2 spec implementation gaps (P0-P2) [`fa45008`](https://github.com/karmaniverous/jeeves-watcher/commit/fa45008b0aebd103302ffa72ed216398615b9674)
- refactor: DRY helper module loading into shared utility [`fef881a`](https://github.com/karmaniverous/jeeves-watcher/commit/fef881a4ae00bb6e09eccfc3fe08b69741d18c4a)
- test: add critical test coverage for utilities and handlers [`b9b94d7`](https://github.com/karmaniverous/jeeves-watcher/commit/b9b94d7be0bf6d39a5df959202c978daaa55284b)
- refactor(DRY): add withApiOptions helper for CLI commands [`26df301`](https://github.com/karmaniverous/jeeves-watcher/commit/26df3015d41b0e351b762a116077f4afcd04a090)
- fix: replace eslint-disable comments with properly typed mocks [`025e322`](https://github.com/karmaniverous/jeeves-watcher/commit/025e322946827fc0ffd37258d3fa5cf1cf2fa0f8)
- feat: expand plugin to 8 tools for v0.5.0 [`bde15f4`](https://github.com/karmaniverous/jeeves-watcher/commit/bde15f465b0ab503519999c5fd0049fa255ebece)
- refactor(SRP): extract app initialization logic to separate module [`63147f4`](https://github.com/karmaniverous/jeeves-watcher/commit/63147f4fce30c692bc134bdb27eda4aa8ee49940)
- feat: two-skill architecture with build pipeline [`898db5e`](https://github.com/karmaniverous/jeeves-watcher/commit/898db5e3253d7986de35b8292afa7e2e944a24c1)
- refactor(SRP/OCP): split embedding providers into separate files [`d07f4c9`](https://github.com/karmaniverous/jeeves-watcher/commit/d07f4c9553c7b926db1a2d8550469fdcff54879d)
- refactor: extract shared mergeAndValidateConfig [`aecab7f`](https://github.com/karmaniverous/jeeves-watcher/commit/aecab7f348f22f3e41160bad251e6d51a8306c5e)
- test: update test files to use new schema format [`336ff00`](https://github.com/karmaniverous/jeeves-watcher/commit/336ff00db2595b125bb3d71d1923d81f0baadf89)
- refactor: extract shared executeReindex to eliminate duplication [`7658108`](https://github.com/karmaniverous/jeeves-watcher/commit/7658108fc9899557fc3d65b82a1947a2bddc1e25)
- test: add DocumentProcessor unit tests [`987012f`](https://github.com/karmaniverous/jeeves-watcher/commit/987012fb754b43c7324929e537ec7676e9848e63)
- test: add more critical test coverage [`233082c`](https://github.com/karmaniverous/jeeves-watcher/commit/233082c410cbd8c32f71cd40e64b6028f08c521e)
- feat: implement Phase 3 API endpoints [`eb697cf`](https://github.com/karmaniverous/jeeves-watcher/commit/eb697cfd894af3dda446d2988fcc2e0eefee2a97)
- refactor(DIP): introduce VectorStore interface and update consumers [`1975dee`](https://github.com/karmaniverous/jeeves-watcher/commit/1975deeb610dafa76aceb4e84e82ca7229cd9b5e)
- refactor(DRY): extract repeated patterns to utilities [`12842de`](https://github.com/karmaniverous/jeeves-watcher/commit/12842dea5442fd38ddea5d6a3c4ad841c0177f43)
- fix: resolve all lint errors in test files and wrapHandler [`bbcde3f`](https://github.com/karmaniverous/jeeves-watcher/commit/bbcde3f8c6e19ff975cfda83826226e93181183b)
- refactor: DRY API handler error handling with wrapHandler; fix writeFileSync in configApply [`8995d2e`](https://github.com/karmaniverous/jeeves-watcher/commit/8995d2e85c48a75503812e20331db8fe88816d38)
- test: add EventQueue tests [`93a7eab`](https://github.com/karmaniverous/jeeves-watcher/commit/93a7eab2573d92ef4ef7217a6c373fe89f3be29f)
- refactor: extract JsonFileStore base for issues/values [`c36112f`](https://github.com/karmaniverous/jeeves-watcher/commit/c36112f43dd415893db4ff999e10b63034870ad8)
- test: add mergedDocument tests [`41a2561`](https://github.com/karmaniverous/jeeves-watcher/commit/41a25615cbaf3e5d1773abd5a78c89e9dc725f1d)
- revert: remove manual CHANGELOG.md edits (auto-generated on release) [`c20e149`](https://github.com/karmaniverous/jeeves-watcher/commit/c20e14967723b52b877acb3de062d276587bcf44)
- test: add configValidate handler tests [`00d52fd`](https://github.com/karmaniverous/jeeves-watcher/commit/00d52fd7a4d19621b7318eb2b6512d062b8e6acf)
- test: add configApply handler tests [`5fb3b43`](https://github.com/karmaniverous/jeeves-watcher/commit/5fb3b436b8a205ef76fdf88389655b2246ec665f)
- test: add configQuery handler tests [`6adfcab`](https://github.com/karmaniverous/jeeves-watcher/commit/6adfcab476aa7c63119c340f5dad7428f8544a41)
- fix: resolve all STAN lint errors and reduce docs warnings [`062594f`](https://github.com/karmaniverous/jeeves-watcher/commit/062594ff6645b7ff35cc90df38e55ee1eab645b3)
- refactor(DIP): add DocumentProcessor interface and update factory/consumers [`8a30433`](https://github.com/karmaniverous/jeeves-watcher/commit/8a30433c4c767eac7ea1eba96153ec3d0ad06107)
- refactor(ISP): convert buildMergedMetadata to options object pattern [`0d67913`](https://github.com/karmaniverous/jeeves-watcher/commit/0d6791301736252bc4fffb068ca06ef30eb554be)
- fix: resolveReferences only resolves known config reference positions [`1890bf9`](https://github.com/karmaniverous/jeeves-watcher/commit/1890bf9a2216c769ca1640e70600e8b079cafbcd)
- fix(lint): address majority of lint issues in new tests [`aec00f8`](https://github.com/karmaniverous/jeeves-watcher/commit/aec00f86b86526d706b1dca3c2d851b77b4c3b75)
- test: add configReindex handler tests [`506b638`](https://github.com/karmaniverous/jeeves-watcher/commit/506b6387ca73af4d368fececb95c19113696313b)
- refactor(ISP): narrow API handler deps to required fields [`309daa3`](https://github.com/karmaniverous/jeeves-watcher/commit/309daa37ba7b296889b6c9b53818e4c2f2549682)
- fix: resolve lint errors and align tests with spec [`29c5217`](https://github.com/karmaniverous/jeeves-watcher/commit/29c52177aa5507817656c441fb67c287e27a8cb4)
- refactor(SRP): extract shared template/map helper wiring from JeevesWatcher [`7d1b629`](https://github.com/karmaniverous/jeeves-watcher/commit/7d1b6299c8055ae15fbbf6c000b9eb0f166219a3)
- test: add ReindexTracker tests [`5830048`](https://github.com/karmaniverous/jeeves-watcher/commit/5830048c62a9950b4f5940f99c140d6caa5b161f)
- refactor(DRY): extract vectorStore payload type inference [`8f70a7c`](https://github.com/karmaniverous/jeeves-watcher/commit/8f70a7c99a2937e26b6f1aa27317a6304e40947b)
- fix: implement actual rule matching in testPaths validation [`dba6f4e`](https://github.com/karmaniverous/jeeves-watcher/commit/dba6f4e79f4a2013e42060d84f993bb36346d95d)
- refactor(DRY): align logError helper signature with standard pattern [`a014202`](https://github.com/karmaniverous/jeeves-watcher/commit/a014202e0795d015b913e4e113e427f51edeb76f)
- refactor: centralize processor payload field names [`34836ce`](https://github.com/karmaniverous/jeeves-watcher/commit/34836cebe3d66dab7ae7475ac0aa1ca5dfcd4aa3)
- refactor(DRY): apply logError utility in DocumentProcessor [`42f5b3e`](https://github.com/karmaniverous/jeeves-watcher/commit/42f5b3e5d6b2a3dc9af886107e9ae981b6fb0108)
- fix: resolve typecheck errors in tests and initialization [`47b92e1`](https://github.com/karmaniverous/jeeves-watcher/commit/47b92e1b43b9513273c2a4bff1a119a774243043)
- refactor(OCP): allow custom extractors via additionalExtractors parameter [`36b7ae2`](https://github.com/karmaniverous/jeeves-watcher/commit/36b7ae29cdc24109feb8c1a00555f93c5a1a5850)
- fix(lint): resolve unsafe-assignment and unbound-method in tests [`9e41021`](https://github.com/karmaniverous/jeeves-watcher/commit/9e41021de4513b8cb9f684bbf90e184b5559011e)
- chore: tune docs warnPattern to ignore Zod enum TSDoc warnings [`b09909a`](https://github.com/karmaniverous/jeeves-watcher/commit/b09909a51b5b076ea071c2e83047c21eec1f594f)

#### [0.4.4](https://github.com/karmaniverous/jeeves-watcher/compare/0.4.3...0.4.4)

> 23 February 2026

- fix: use pathToFileURL for dynamic imports on Windows [`#31`](https://github.com/karmaniverous/jeeves-watcher/pull/31)
- fix: use pathToFileURL for dynamic imports on Windows (#31) [`#30`](https://github.com/karmaniverous/jeeves-watcher/issues/30)
- chore: release v0.4.4 [`f3a284c`](https://github.com/karmaniverous/jeeves-watcher/commit/f3a284ce1c940f0ea1e5e9338492cc0de61c5b97)

#### [0.4.3](https://github.com/karmaniverous/jeeves-watcher/compare/0.4.2...0.4.3)

> 23 February 2026

- feat: support custom JsonMap lib functions via config [`#29`](https://github.com/karmaniverous/jeeves-watcher/pull/29)
- chore: release v0.4.3 [`8b82d0c`](https://github.com/karmaniverous/jeeves-watcher/commit/8b82d0cf01dee60ab3a135ac6c0c70ae726d31fd)

#### [0.4.2](https://github.com/karmaniverous/jeeves-watcher/compare/0.4.1...0.4.2)

> 23 February 2026

- fix: resolve file path references in named maps config [`#28`](https://github.com/karmaniverous/jeeves-watcher/pull/28)
- chore: release v0.4.2 [`4ea9215`](https://github.com/karmaniverous/jeeves-watcher/commit/4ea9215f5ae9506bf497fffdcbf414160ae03310)

#### [0.4.1](https://github.com/karmaniverous/jeeves-watcher/compare/0.4.0...0.4.1)

> 23 February 2026

- fix: resolve chokidar v5 ignored glob patterns via picomatch matchers [`#27`](https://github.com/karmaniverous/jeeves-watcher/pull/27)
- chore: release v0.4.1 [`c736409`](https://github.com/karmaniverous/jeeves-watcher/commit/c7364099798bc494ea633f376bf747e1cb995209)
- lintfix [`c36da17`](https://github.com/karmaniverous/jeeves-watcher/commit/c36da17951cdbe955e620cf8a8626d2f1bb8a8c1)

#### [0.4.0](https://github.com/karmaniverous/jeeves-watcher/compare/0.3.1...0.4.0)

> 23 February 2026

- fix: adapt to chokidar v4 glob removal — watch directory roots with picomatch filtering [`#26`](https://github.com/karmaniverous/jeeves-watcher/pull/26)
- feat: Content Templates (v0.4.0) — Handlebars-based content transformation at index time [`#23`](https://github.com/karmaniverous/jeeves-watcher/pull/23)
- fix: resolve chokidar glob pattern failure on Windows by extracting directory roots [`#25`](https://github.com/karmaniverous/jeeves-watcher/issues/25)
- feat: add template engine dependencies (handlebars, mdast-util-from-adf, etc.) [`f6d090c`](https://github.com/karmaniverous/jeeves-watcher/commit/f6d090cfe710adf94013e2d5a6f791ce72474f7a)
- chore: release v0.4.0 [`79f7f8d`](https://github.com/karmaniverous/jeeves-watcher/commit/79f7f8d002f7deae4d4923e9e490f0e3d4e8ca3a)
- chore: update deps (hast, knip, rollup) [`3790582`](https://github.com/karmaniverous/jeeves-watcher/commit/3790582cdd5f984fc3101ed93580e34de0fccc4d)
- feat: export template engine types, fix knip (add hast dep) [`7ae0597`](https://github.com/karmaniverous/jeeves-watcher/commit/7ae059712e46ecabcbf7539814a0783bb9410dc6)
- refactor: decompose app/index.ts into factories and startFromConfig modules (300 LOC limit) [`33736c2`](https://github.com/karmaniverous/jeeves-watcher/commit/33736c2f2418c85c4b2c81cd48dc08758de62dcb)
- feat: add template engine module and config schema changes [`968132f`](https://github.com/karmaniverous/jeeves-watcher/commit/968132f71cc7159afd574a4d3e90a67784a8e0ac)
- feat: integrate template engine into pipeline (applyRules, processFile, config reload) [`64cc135`](https://github.com/karmaniverous/jeeves-watcher/commit/64cc13509c54532a09d04647e08df8795bbcff57)
- test: add template engine tests and update existing rule tests for new return shape [`d6ef7d7`](https://github.com/karmaniverous/jeeves-watcher/commit/d6ef7d7a54f20d54e0b88a36505eca74606751f5)
- docs: add content templates section to inference-rules guide [`ebf74ef`](https://github.com/karmaniverous/jeeves-watcher/commit/ebf74efc7fdba17dc4c90f7b477be3d415f716f1)
- docs: add production directory structure guidance for maps and templates [`14c51c8`](https://github.com/karmaniverous/jeeves-watcher/commit/14c51c83fedb4d626e56a021870260ccf13eefcf)

#### [0.3.1](https://github.com/karmaniverous/jeeves-watcher/compare/0.3.0...0.3.1)

> 23 February 2026

- fix: restore shebang in CLI output for correct npm .cmd wrapper generation [`#20`](https://github.com/karmaniverous/jeeves-watcher/pull/20)
- chore: release v0.3.1 [`8a6de18`](https://github.com/karmaniverous/jeeves-watcher/commit/8a6de183a9ab5214f83d395cebd547da799f7834)

#### [0.3.0](https://github.com/karmaniverous/jeeves-watcher/compare/0.2.6...0.3.0)

> 22 February 2026

- feat: OpenClaw plugin with agent tools and skill (v0.3.0) [`#19`](https://github.com/karmaniverous/jeeves-watcher/pull/19)
- docs: sync all documentation with implementation [`#17`](https://github.com/karmaniverous/jeeves-watcher/pull/17)
- chore: release v0.3.0 [`0e03c00`](https://github.com/karmaniverous/jeeves-watcher/commit/0e03c000e94d776a6724b8e92de4a7a432808785)
- docs: sync documentation with implementation [`8442160`](https://github.com/karmaniverous/jeeves-watcher/commit/844216071098d3e2672cd284df06723d3af6c71e)

#### [0.2.6](https://github.com/karmaniverous/jeeves-watcher/compare/0.2.5...0.2.6)

> 22 February 2026

- fix: remove shebang from ESM CLI output [`#16`](https://github.com/karmaniverous/jeeves-watcher/pull/16)
- [ISSUE-15] fix: remove shebang from ESM CLI output (closes #15) [`#15`](https://github.com/karmaniverous/jeeves-watcher/issues/15)
- chore: release v0.2.6 [`2fe3b56`](https://github.com/karmaniverous/jeeves-watcher/commit/2fe3b56d05d3ae258196214a010dab86d2ab9df4)

#### [0.2.5](https://github.com/karmaniverous/jeeves-watcher/compare/0.2.4...0.2.5)

> 22 February 2026

- feat: respect .gitignore patterns in watched directories [`#14`](https://github.com/karmaniverous/jeeves-watcher/pull/14)
- chore: release v0.2.5 [`6e86776`](https://github.com/karmaniverous/jeeves-watcher/commit/6e867768970a01718a219f49fc1f4e58eb1d6453)
- feat: add gitignore filter service with ignore package [`b840a9d`](https://github.com/karmaniverous/jeeves-watcher/commit/b840a9dd8f994be1215bc4c475c9fe58d18336b5)
- feat: add respectGitignore config option [`ec34a48`](https://github.com/karmaniverous/jeeves-watcher/commit/ec34a4833bc3c7842a1a49e5c221fb558f7ba07f)
- test: add gitignore integration test [`4993208`](https://github.com/karmaniverous/jeeves-watcher/commit/4993208194b933711addfdbe7b649070c5ae9092)
- fix: support glob watch paths in gitignore filter scan [`dbccaf0`](https://github.com/karmaniverous/jeeves-watcher/commit/dbccaf08092ead8e0eb575766102580120616c2b)
- feat: integrate gitignore filtering into processing pipeline [`9f5bf1b`](https://github.com/karmaniverous/jeeves-watcher/commit/9f5bf1b47583b7a9bd6a60d3bdeda1287c429aaa)
- docs: document gitignore support in README [`86d1329`](https://github.com/karmaniverous/jeeves-watcher/commit/86d1329388b0618c5e733230157461ca0c80e8a0)

#### [0.2.4](https://github.com/karmaniverous/jeeves-watcher/compare/0.2.3...0.2.4)

> 22 February 2026

- feat: graceful error handling with BOM stripping, system health tracking, and exponential backoff [`#12`](https://github.com/karmaniverous/jeeves-watcher/pull/12)
- chore: release v0.2.4 [`6d4d18e`](https://github.com/karmaniverous/jeeves-watcher/commit/6d4d18ef894b842a06d3d5c59ded83efa36a2fe0)
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
