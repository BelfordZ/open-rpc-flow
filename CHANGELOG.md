## [1.4.4](https://github.com/BelfordZ/open-rpc-flow/compare/v1.4.3...v1.4.4) (2025-05-16)


### Bug Fixes

* update readme ([#59](https://github.com/BelfordZ/open-rpc-flow/issues/59)) ([7f5d691](https://github.com/BelfordZ/open-rpc-flow/commit/7f5d6915880bb02c6bbe6e93f6f98abc95cc5c39))

## [1.5.0](https://github.com/BelfordZ/open-rpc-flow/compare/v1.4.4...v1.5.0) (2026-02-16)


### Features

* add correlation id metadata to step events ([#100](https://github.com/BelfordZ/open-rpc-flow/issues/100)) ([dcebdb0](https://github.com/BelfordZ/open-rpc-flow/commit/dcebdb0ac655abdf5d3c3f5e64aa8935677bc7b3))
* add delay step ([#92](https://github.com/BelfordZ/open-rpc-flow/issues/92)) ([368087a](https://github.com/BelfordZ/open-rpc-flow/commit/368087a26f95156e93b6dd9f3de8a381eb024205))
* add flow resume retry pause api ([#123](https://github.com/BelfordZ/open-rpc-flow/issues/123)) ([6608778](https://github.com/BelfordZ/open-rpc-flow/commit/6608778ee02c3d05a5fea3107260a99b26619105))
* add input type debug logs ([#104](https://github.com/BelfordZ/open-rpc-flow/issues/104)) ([a50d894](https://github.com/BelfordZ/open-rpc-flow/commit/a50d894c49b32fd95a43f4a699dac768a14297c0))
* add parallel flow execution policies ([#134](https://github.com/BelfordZ/open-rpc-flow/issues/134)) ([d3f7679](https://github.com/BelfordZ/open-rpc-flow/commit/d3f7679c1b5b4c16c9088ae8ce32a2c67601f889))
* add resumeFrom API for restarting at a specific step ([#132](https://github.com/BelfordZ/open-rpc-flow/issues/132)) ([99353fb](https://github.com/BelfordZ/open-rpc-flow/commit/99353fbae3d2820f1670b1162729a36d449608bf))
* add warning logs for retries and request errors ([#91](https://github.com/BelfordZ/open-rpc-flow/issues/91)) ([d69f1f4](https://github.com/BelfordZ/open-rpc-flow/commit/d69f1f4f5097b2323cf435d4d3cefb61498a120d))
* emit loop progress events ([#95](https://github.com/BelfordZ/open-rpc-flow/issues/95)) ([e97cf9d](https://github.com/BelfordZ/open-rpc-flow/commit/e97cf9dd032a7e5f7f1f1a202bb9640c53207510))
* export PathSegment ([#84](https://github.com/BelfordZ/open-rpc-flow/issues/84)) ([0914d64](https://github.com/BelfordZ/open-rpc-flow/commit/0914d64a8ef6b050793f07f0db692334473210f8))
* export StepExecutionContext ([#85](https://github.com/BelfordZ/open-rpc-flow/issues/85)) ([255bab7](https://github.com/BelfordZ/open-rpc-flow/commit/255bab7ecbf7280130f2cfc4a29eb5b1e34cb1fa))
* export TimeoutError from index ([#88](https://github.com/BelfordZ/open-rpc-flow/issues/88)) ([9e19332](https://github.com/BelfordZ/open-rpc-flow/commit/9e19332ad982bdc8e9ca20614bd98420d1215b2f))
* expose step executors via public API ([#86](https://github.com/BelfordZ/open-rpc-flow/issues/86)) ([1e9c16c](https://github.com/BelfordZ/open-rpc-flow/commit/1e9c16c52eb5307e3b2263680edc7a4f2b388a50))
* introduce strong types for context and policy ([#89](https://github.com/BelfordZ/open-rpc-flow/issues/89)) ([425bbcb](https://github.com/BelfordZ/open-rpc-flow/commit/425bbcbb05cd41820f578e2876cd106a0f154555))
* re-export StepExecutor classes ([#87](https://github.com/BelfordZ/open-rpc-flow/issues/87)) ([b310d43](https://github.com/BelfordZ/open-rpc-flow/commit/b310d43707827936160774e551a367adbdf81f19))
* **schema:** add step description field ([#94](https://github.com/BelfordZ/open-rpc-flow/issues/94)) ([11e74bf](https://github.com/BelfordZ/open-rpc-flow/commit/11e74bf945263b0a9da8d8d671e4885dcd27973b))
* strongly type step events ([#82](https://github.com/BelfordZ/open-rpc-flow/issues/82)) ([2c8a6ba](https://github.com/BelfordZ/open-rpc-flow/commit/2c8a6ba2e31b736384db8bb074564fbe8f1f34e3))


### Bug Fixes

* add agents ([38bd926](https://github.com/BelfordZ/open-rpc-flow/commit/38bd926616a72c2c32ef2584d8592a73bb6fdf1e))
* add engines to packagejson ([#61](https://github.com/BelfordZ/open-rpc-flow/issues/61)) ([be556f7](https://github.com/BelfordZ/open-rpc-flow/commit/be556f71e5d40926112c250ce5129a884e5e4b16))
* add license and contributing ([#58](https://github.com/BelfordZ/open-rpc-flow/issues/58)) ([166d57d](https://github.com/BelfordZ/open-rpc-flow/commit/166d57dbc5788d76395deb6b80508ea7c91e7b1d))
* add repo to package.json ([#60](https://github.com/BelfordZ/open-rpc-flow/issues/60)) ([ab2cfd2](https://github.com/BelfordZ/open-rpc-flow/commit/ab2cfd2b93192676e8b7a7a184714f3f4d85cade))
* align flow-level timeouts and abort events ([#97](https://github.com/BelfordZ/open-rpc-flow/issues/97)) ([34dd9b5](https://github.com/BelfordZ/open-rpc-flow/commit/34dd9b5847e1cfdfaacb301c19eaa5ed3482ae98))
* correct repository url for release ([#135](https://github.com/BelfordZ/open-rpc-flow/issues/135)) ([c6db131](https://github.com/BelfordZ/open-rpc-flow/commit/c6db131f9601ed5df2fb94ed2e28d7d1f7726f03))
* de-duplicate getStepType ([#80](https://github.com/BelfordZ/open-rpc-flow/issues/80)) ([340b9ac](https://github.com/BelfordZ/open-rpc-flow/commit/340b9ac33b5385a13f041dc7d669974a935fc695))
* format fix ([#65](https://github.com/BelfordZ/open-rpc-flow/issues/65)) ([a933329](https://github.com/BelfordZ/open-rpc-flow/commit/a933329caf68a518fb93ca760b439ed45d931b56))
* improved typing on flow error and arrays ([#62](https://github.com/BelfordZ/open-rpc-flow/issues/62)) ([d0b0a4b](https://github.com/BelfordZ/open-rpc-flow/commit/d0b0a4bf2579e64f1a30150517193c1316a664b7))
* issue with basic refs ([#52](https://github.com/BelfordZ/open-rpc-flow/issues/52)) ([121b93b](https://github.com/BelfordZ/open-rpc-flow/commit/121b93b2263e53156ece04e39218d9e3d69f74d5))
* logger type safety ([#68](https://github.com/BelfordZ/open-rpc-flow/issues/68)) ([be87736](https://github.com/BelfordZ/open-rpc-flow/commit/be87736f1cf330ff3f7c1b3d6f7f6a1a52719aa8))
* policty resolver for timeouts ([#63](https://github.com/BelfordZ/open-rpc-flow/issues/63)) ([89b8658](https://github.com/BelfordZ/open-rpc-flow/commit/89b86581872d041a7dd5bf29a4c108522f28f5ee))
* switch from log to info for logging ([#54](https://github.com/BelfordZ/open-rpc-flow/issues/54)) ([f6cb605](https://github.com/BelfordZ/open-rpc-flow/commit/f6cb60589e24765bc6ac6c6309dca5ccfbe2bdb8))
* typed interface for AST nodes ([#67](https://github.com/BelfordZ/open-rpc-flow/issues/67)) ([db41e94](https://github.com/BelfordZ/open-rpc-flow/commit/db41e9482bdc306075189c2ac1a3be10e93941e3))
* update metadata inputType logic ([#53](https://github.com/BelfordZ/open-rpc-flow/issues/53)) ([e669ae0](https://github.com/BelfordZ/open-rpc-flow/commit/e669ae042bc9f70e4ba39954533cd63e5ff89f0d))
* update repo name in readme ([#66](https://github.com/BelfordZ/open-rpc-flow/issues/66)) ([11605f0](https://github.com/BelfordZ/open-rpc-flow/commit/11605f047ecf19d8f2d153f2e04a5faa947eae8a))
* whitespace removal in literal ([#64](https://github.com/BelfordZ/open-rpc-flow/issues/64)) ([e354609](https://github.com/BelfordZ/open-rpc-flow/commit/e35460989a61a78ce9b64c7ce126cf6bd1fb2ed8))

## [1.4.3](https://github.com/BelfordZ/open-rpc-flow/compare/v1.4.2...v1.4.3) (2025-05-16)


### Bug Fixes

* typo ([#57](https://github.com/BelfordZ/open-rpc-flow/issues/57)) ([c9afcfc](https://github.com/BelfordZ/open-rpc-flow/commit/c9afcfc486d8303533f7019fd39f048e655cc562))

## [1.4.2](https://github.com/BelfordZ/open-rpc-flow/compare/v1.4.1...v1.4.2) (2025-05-16)


### Bug Fixes

* improve examples ([#56](https://github.com/BelfordZ/open-rpc-flow/issues/56)) ([58181e3](https://github.com/BelfordZ/open-rpc-flow/commit/58181e38656c0879006b62f87691cafd4a09f6ea))

## [1.4.1](https://github.com/BelfordZ/open-rpc-flow/compare/v1.4.0...v1.4.1) (2025-05-16)


### Bug Fixes

* update readme ([#55](https://github.com/BelfordZ/open-rpc-flow/issues/55)) ([11a4b8c](https://github.com/BelfordZ/open-rpc-flow/commit/11a4b8c8629a2423be4ae9f02a1ba1c1a17c77a3))

# [1.4.0](https://github.com/BelfordZ/open-rpc-flow/compare/v1.3.7...v1.4.0) (2025-05-16)


### Features

* events ([#48](https://github.com/BelfordZ/open-rpc-flow/issues/48)) ([3ff27f3](https://github.com/BelfordZ/open-rpc-flow/commit/3ff27f377b04d8b6e57a9ded15b1ec7c35357497))

## [1.3.7](https://github.com/BelfordZ/open-rpc-flow/compare/v1.3.6...v1.3.7) (2025-03-29)


### Bug Fixes

* change the readme to bump release ([#50](https://github.com/BelfordZ/open-rpc-flow/issues/50)) ([f19e452](https://github.com/BelfordZ/open-rpc-flow/commit/f19e452164014b4d8c5df92bb3fce3ac73c4668f))

## [1.3.6](https://github.com/BelfordZ/open-rpc-flow/compare/v1.3.5...v1.3.6) (2025-03-13)


### Bug Fixes

* remove pattern requirements for name ([#41](https://github.com/BelfordZ/open-rpc-flow/issues/41)) ([a27ce76](https://github.com/BelfordZ/open-rpc-flow/commit/a27ce768da444bdde403278fa1eeeb08d80d406d))

## [1.3.5](https://github.com/BelfordZ/open-rpc-flow/compare/v1.3.4...v1.3.5) (2025-03-10)


### Bug Fixes

* loosen metaschema for Flow required props ([#40](https://github.com/BelfordZ/open-rpc-flow/issues/40)) ([fec06e2](https://github.com/BelfordZ/open-rpc-flow/commit/fec06e219c86fc389306b45457e089a75612b50d))

## [1.3.4](https://github.com/BelfordZ/open-rpc-flow/compare/v1.3.3...v1.3.4) (2025-03-04)


### Bug Fixes

* add support for loop steps in meta schema ([2e500be](https://github.com/BelfordZ/open-rpc-flow/commit/2e500be968822d08a195932ebd12456d971a30dc))

## [1.3.3](https://github.com/BelfordZ/open-rpc-flow/compare/v1.3.2...v1.3.3) (2025-02-17)


### Bug Fixes

* adjust coverage numbers ([3fd9835](https://github.com/BelfordZ/open-rpc-flow/commit/3fd9835e399afb49171b2224ead5f5b59c5c9bd0))
* linting and formatting ([b939898](https://github.com/BelfordZ/open-rpc-flow/commit/b93989827a7be480540e6c9502b585316833c1cb))
* tokenizer fix to properly handle period juice ([0340fd2](https://github.com/BelfordZ/open-rpc-flow/commit/0340fd21bcd8d7078055bdf948f95203c9c1371a))

## [1.3.2](https://github.com/BelfordZ/open-rpc-flow/compare/v1.3.1...v1.3.2) (2025-02-08)


### Bug Fixes

* bump release ([#33](https://github.com/BelfordZ/open-rpc-flow/issues/33)) ([0c53dec](https://github.com/BelfordZ/open-rpc-flow/commit/0c53decc6326f5da604444305712a7e253e2f4c8))

## [1.3.1](https://github.com/BelfordZ/open-rpc-flow/compare/v1.3.0...v1.3.1) (2025-02-06)


### Bug Fixes

* require "endWorkflow" in stop step ([9d214b5](https://github.com/BelfordZ/open-rpc-flow/commit/9d214b5530f37f54141f330d6040055eccc10cc4))

# [1.3.0](https://github.com/BelfordZ/open-rpc-flow/compare/v1.2.0...v1.3.0) (2025-02-06)


### Bug Fixes

* add jest it up ([0179cdf](https://github.com/BelfordZ/open-rpc-flow/commit/0179cdf6f639a35c2429691ff4bfbc6180f8c5e2))
* dont use stubs lol ([16a443b](https://github.com/BelfordZ/open-rpc-flow/commit/16a443b970376812a73376b072369dae3b42e56b))
* prettier ([ae753bd](https://github.com/BelfordZ/open-rpc-flow/commit/ae753bd3e90883f33ad4a5e11e4d44fc31d86c35))
* remove dead code ([d7785e4](https://github.com/BelfordZ/open-rpc-flow/commit/d7785e4e5ef3bb346cdbbb5f8648358d034af3f3))
* remove funk ([9ed6fa2](https://github.com/BelfordZ/open-rpc-flow/commit/9ed6fa245fbbe0612e59b30c766c080582e36272))
* restore stuff i should not have been touching ([45df210](https://github.com/BelfordZ/open-rpc-flow/commit/45df210d1f752c5041510eb674d5388e05760a04))
* update lots of stuff ([52db6ec](https://github.com/BelfordZ/open-rpc-flow/commit/52db6ec0298e3a9a6858fd547cac48d923806c97))


### Features

* add mermaid diagrams ([4a95852](https://github.com/BelfordZ/open-rpc-flow/commit/4a9585224c974e17fd9cd4b2bdf3b48da95f7484))

# [1.2.0](https://github.com/BelfordZ/open-rpc-flow/compare/v1.1.2...v1.2.0) (2025-01-31)


### Bug Fixes

* linting and tests ([90c44fa](https://github.com/BelfordZ/open-rpc-flow/commit/90c44fab6760ba70040c331b1be4ac595e917fe2))


### Features

* introduce a stop step type to end workflows ([894e4ef](https://github.com/BelfordZ/open-rpc-flow/commit/894e4ef21f8dbd61f4d0055570553972abe2d9dd)), closes [#21](https://github.com/BelfordZ/open-rpc-flow/issues/21)

## [1.1.2](https://github.com/BelfordZ/open-rpc-flow/compare/v1.1.1...v1.1.2) (2025-01-31)


### Bug Fixes

* add test for condition without else branch ([679859d](https://github.com/BelfordZ/open-rpc-flow/commit/679859d0162eb9d8a80dbe8aaafe6fe4b579389b)), closes [#18](https://github.com/BelfordZ/open-rpc-flow/issues/18)

## [1.1.1](https://github.com/BelfordZ/open-rpc-flow/compare/v1.1.0...v1.1.1) (2025-01-25)


### Bug Fixes

* get close to 100% coverage ([678eaa3](https://github.com/BelfordZ/open-rpc-flow/commit/678eaa3f62c477c41a139c4209e547bfad74ff4b))
* get test coverage numbers up ([0601655](https://github.com/BelfordZ/open-rpc-flow/commit/0601655175e3ac160171488c865d4b42c489af06))
* run prettier ([610da7f](https://github.com/BelfordZ/open-rpc-flow/commit/610da7f8a84203b00d2beaf7b52040f3310b6d44))

# [1.1.0](https://github.com/BelfordZ/open-rpc-flow/compare/v1.0.6...v1.1.0) (2025-01-24)


### Features

* updated examples ([#15](https://github.com/BelfordZ/open-rpc-flow/issues/15)) ([c50c603](https://github.com/BelfordZ/open-rpc-flow/commit/c50c603f819fa5d4975a33a0525c075cf726dd88))

## [1.0.6](https://github.com/BelfordZ/open-rpc-flow/compare/v1.0.5...v1.0.6) (2025-01-11)


### Bug Fixes

* issue with string with object ref in it ([#11](https://github.com/BelfordZ/open-rpc-flow/issues/11)) ([2ba27be](https://github.com/BelfordZ/open-rpc-flow/commit/2ba27be8c36a64f39957686a815e8f915bc61e03))

## [1.0.5](https://github.com/BelfordZ/open-rpc-flow/compare/v1.0.4...v1.0.5) (2025-01-09)


### Bug Fixes

* point at correct path to index.js ([#10](https://github.com/BelfordZ/open-rpc-flow/issues/10)) ([131c5d5](https://github.com/BelfordZ/open-rpc-flow/commit/131c5d598fbd45ca024088eac6d3b20514e47ebe))

## [1.0.4](https://github.com/BelfordZ/open-rpc-flow/compare/v1.0.3...v1.0.4) (2025-01-09)


### Bug Fixes

* include metaschema in build ([#9](https://github.com/BelfordZ/open-rpc-flow/issues/9)) ([6208bfa](https://github.com/BelfordZ/open-rpc-flow/commit/6208bfaf3158625639c4dcc6af4e2df5d5006ad1))

## [1.0.3](https://github.com/BelfordZ/open-rpc-flow/compare/v1.0.2...v1.0.3) (2025-01-09)


### Bug Fixes

* add prettierignore ([#8](https://github.com/BelfordZ/open-rpc-flow/issues/8)) ([9897dc7](https://github.com/BelfordZ/open-rpc-flow/commit/9897dc7cb354fb9adfc14b5933caa99face4a7e2))

## [1.0.2](https://github.com/BelfordZ/open-rpc-flow/compare/v1.0.1...v1.0.2) (2025-01-09)

### Bug Fixes

- build before release ([#6](https://github.com/BelfordZ/open-rpc-flow/issues/6)) ([08fed56](https://github.com/BelfordZ/open-rpc-flow/commit/08fed563c27064ae74a7164f1c4a167a287ce405))

## [1.0.1](https://github.com/BelfordZ/open-rpc-flow/compare/v1.0.0...v1.0.1) (2025-01-09)

### Bug Fixes

- bad example ([#4](https://github.com/BelfordZ/open-rpc-flow/issues/4)) ([4c1f2be](https://github.com/BelfordZ/open-rpc-flow/commit/4c1f2bedd17fe041fe1536c3fa7d36ba508e80eb))
- big readme update ([#3](https://github.com/BelfordZ/open-rpc-flow/issues/3)) ([ae91c01](https://github.com/BelfordZ/open-rpc-flow/commit/ae91c01e701cddd4bf1725a6c170d3517760f940))
- forgot to include dist folder ([#5](https://github.com/BelfordZ/open-rpc-flow/issues/5)) ([8e0eef0](https://github.com/BelfordZ/open-rpc-flow/commit/8e0eef003801ee5f6c442a917a69c5f28b2e1a88))

# 1.0.0 (2025-01-09)

### Bug Fixes

- all linting issues resolved ([35351d8](https://github.com/BelfordZ/open-rpc-flow/commit/35351d8d03b35cb7bbf9723b92809066dbbf727e))
- condition executor tests ([72720d7](https://github.com/BelfordZ/open-rpc-flow/commit/72720d717e35949293abb3e34e663d08b9a1675d))
- deprecation warnings ([11f1807](https://github.com/BelfordZ/open-rpc-flow/commit/11f180744367c5655a2745aa82245f70fa1c2147))
- dont use precommit hook for prettier ([7fd4a64](https://github.com/BelfordZ/open-rpc-flow/commit/7fd4a642f51884202f61070dac6a175d66333809))
- loop step executor test passing ([bb9613a](https://github.com/BelfordZ/open-rpc-flow/commit/bb9613a2835f4a8abc22fdb6ea3326279316b223))
- permissions problems ([b108a5e](https://github.com/BelfordZ/open-rpc-flow/commit/b108a5e20e819eba3be124804a3d68ee01947926))
- removed husky all together git hooks blow ([2db65c9](https://github.com/BelfordZ/open-rpc-flow/commit/2db65c95d476a2ea40985b214c49553145869479))
- run prettier ([29e9949](https://github.com/BelfordZ/open-rpc-flow/commit/29e9949d295c37af60f86ad98768c3894a6f4d69))
- update branch name to master in CI/CD configs ([01171d8](https://github.com/BelfordZ/open-rpc-flow/commit/01171d8776e068491e4f0c2ccb9c612282195d2d))
- update docs ([ba1d1d4](https://github.com/BelfordZ/open-rpc-flow/commit/ba1d1d4e3af3d880fa796cb84c3a886bee9354fa))

### Features

- add CI/CD workflows and tooling ([5edcf38](https://github.com/BelfordZ/open-rpc-flow/commit/5edcf38c0a657fec114cacd0139f7e09f87256f3))
