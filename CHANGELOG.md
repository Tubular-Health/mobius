# Changelog

## [1.7.0](https://github.com/Tubular-Health/mobius/compare/mobius-ai-v1.6.0...mobius-ai-v1.7.0) (2026-02-02)


### Features

* **cli:** export MOBIUS_TASK_ID on ml selection ([#53](https://github.com/Tubular-Health/mobius/issues/53)) ([d42bd9f](https://github.com/Tubular-Health/mobius/commit/d42bd9ff6df51ceb14a3d4c814c72d5507f11c1d))


### Bug Fixes

* **context:** add local backend logic and workspace context tests ([#55](https://github.com/Tubular-Health/mobius/issues/55)) ([3bc9a0d](https://github.com/Tubular-Health/mobius/commit/3bc9a0d7688e8eca1f696c23a74232bef3fc4554))

## [1.6.0](https://github.com/Tubular-Health/mobius/compare/mobius-ai-v1.5.0...mobius-ai-v1.6.0) (2026-02-02)


### Features

* **cli:** add list and clean commands with shell shortcuts ([#52](https://github.com/Tubular-Health/mobius/issues/52)) ([62198e3](https://github.com/Tubular-Health/mobius/commit/62198e3a8e6c62407e28606c19c94b9949cb0e7d))
* **linear:** add fetchLinearIssueStatus function ([c4920ab](https://github.com/Tubular-Health/mobius/commit/c4920ab4f7916f6411b6a5ba53fd555ebf599149))
* local-first sub-task reading and --no-sandbox flag ([#44](https://github.com/Tubular-Health/mobius/issues/44)) ([db8c475](https://github.com/Tubular-Health/mobius/commit/db8c47502ce0bf33f1343bd5261506dd0b6ee047))
* **local-state:** implement local-first state management for define/refine/execute lifecycle ([#42](https://github.com/Tubular-Health/mobius/issues/42)) ([d2fd4e7](https://github.com/Tubular-Health/mobius/commit/d2fd4e700009e5a72504fb97c53ed698a65f2cdd))
* **loop:** add automatic PR submission after successful completion ([#49](https://github.com/Tubular-Health/mobius/issues/49)) ([77ebd4c](https://github.com/Tubular-Health/mobius/commit/77ebd4cfca0cb631c170aec85360685d72a5c5ec))
* migrate from linear-cli to linearis ([8e14623](https://github.com/Tubular-Health/mobius/commit/8e1462338d17962c08e718b8ee88107d777b7c54))
* **setup:** add CLI detection and installer for backend tools ([#45](https://github.com/Tubular-Health/mobius/issues/45)) ([31f0e15](https://github.com/Tubular-Health/mobius/commit/31f0e15e36839255364dddf36e13d6ec7a559fc0))
* **shortcuts:** add shell shorthand functions for define-refine-execute-submit workflow ([#48](https://github.com/Tubular-Health/mobius/issues/48)) ([63e35cf](https://github.com/Tubular-Health/mobius/commit/63e35cfc8db4ba480c7c3aa613e38919e1f4d388))
* **skills:** replace MCP tool usage with CLI commands in skills and config ([#47](https://github.com/Tubular-Health/mobius/issues/47)) ([4bfce3b](https://github.com/Tubular-Health/mobius/commit/4bfce3b92cb3f0c5eb2fe6f7156144ca535a6656))
* **verification:** add project detection and build-aware verify skill ([#51](https://github.com/Tubular-Health/mobius/issues/51)) ([ed68501](https://github.com/Tubular-Health/mobius/commit/ed685010cee9178758cccfd64a74e682a9d35bc5))


### Bug Fixes

* harden local state handling and broaden ID patterns ([#46](https://github.com/Tubular-Health/mobius/issues/46)) ([1dddbbd](https://github.com/Tubular-Health/mobius/commit/1dddbbd334bd2687fc53180c9a6be132c5d26b7c))


### Miscellaneous Chores

* remove .mobius from tracking ([bb6b99a](https://github.com/Tubular-Health/mobius/commit/bb6b99adf1bdd21afc9edfc351f59d2186a75482))
* update claue permissions ([64193bb](https://github.com/Tubular-Health/mobius/commit/64193bbb34ffc5472a5a21880828358c5d794514))

## [1.5.0](https://github.com/Tubular-Health/mobius/compare/mobius-ai-v1.4.0...mobius-ai-v1.5.0) (2026-01-30)


### Features

* **skill:** add per-task subagent phase to refine-issue ([#40](https://github.com/Tubular-Health/mobius/issues/40)) ([40e6ad9](https://github.com/Tubular-Health/mobius/commit/40e6ad9df4e27885758dc17943a8af293e51abe5))

## [1.4.0](https://github.com/Tubular-Health/mobius/compare/mobius-ai-v1.3.0...mobius-ai-v1.4.0) (2026-01-29)


### Features

* **setup:** add --update-skills flag for quick skills/commands refresh ([#39](https://github.com/Tubular-Health/mobius/issues/39)) ([261257d](https://github.com/Tubular-Health/mobius/commit/261257d55cf4fcb1685683b342584cc881d05d7a))


### Code Refactoring

* **context:** replace MCP tools with SDK-based local context system ([#37](https://github.com/Tubular-Health/mobius/issues/37)) ([10288e9](https://github.com/Tubular-Health/mobius/commit/10288e94bb1a8715fba85ebf14feb01ba778ea39))

## [1.3.0](https://github.com/Tubular-Health/mobius/compare/mobius-ai-v1.2.3...mobius-ai-v1.3.0) (2026-01-28)


### Features

* **loop:** stop loop when verification sub-task completes successfully ([#34](https://github.com/Tubular-Health/mobius/issues/34)) ([c13c688](https://github.com/Tubular-Health/mobius/commit/c13c68853f4e6d8c1f0e4cf3dd69ad45f903051b))
* **verify-issue:** add verification config and Jira documentation ([#32](https://github.com/Tubular-Health/mobius/issues/32)) ([c8d46bb](https://github.com/Tubular-Health/mobius/commit/c8d46bb5dfd198b1df25757a20acee06ac5c67ba))


### Bug Fixes

* **jira:** implement proper issue link creation for task dependencies ([#31](https://github.com/Tubular-Health/mobius/issues/31)) ([571866c](https://github.com/Tubular-Health/mobius/commit/571866ca1f4d3f4d850f902e799490f7708746c9))
* **tui:** use completedTasks to override stale graph status in TaskTree ([#36](https://github.com/Tubular-Health/mobius/issues/36)) ([7848945](https://github.com/Tubular-Health/mobius/commit/78489457f209f7711af7be749ce717cecd1e3edf))


### Tests

* **parallel:** add comprehensive test suite for parallel mobius loop execution ([#35](https://github.com/Tubular-Health/mobius/issues/35)) ([273e1ff](https://github.com/Tubular-Health/mobius/commit/273e1ffc24b95481ae5851193579a83e619a284b))

## [1.2.3](https://github.com/Tubular-Health/mobius/compare/mobius-ai-v1.2.2...mobius-ai-v1.2.3) (2026-01-27)


### Bug Fixes

* **parallel-executor:** add --verbose flag for stream-json output ([#29](https://github.com/Tubular-Health/mobius/issues/29)) ([f22da29](https://github.com/Tubular-Health/mobius/commit/f22da298ae622304366e582542acc66f81c17258))

## [1.2.2](https://github.com/Tubular-Health/mobius/compare/mobius-ai-v1.2.1...mobius-ai-v1.2.2) (2026-01-27)


### Bug Fixes

* **jira:** migrate to new JQL enhanced search API ([#27](https://github.com/Tubular-Health/mobius/issues/27)) ([f1eb1d8](https://github.com/Tubular-Health/mobius/commit/f1eb1d8de8c40eff413c2e6cd133099552093e81))

## [1.2.1](https://github.com/Tubular-Health/mobius/compare/mobius-ai-v1.2.0...mobius-ai-v1.2.1) (2026-01-27)


### Bug Fixes

* **jira:** improve error logging for sub-task fetch failures ([#25](https://github.com/Tubular-Health/mobius/issues/25)) ([6d71f53](https://github.com/Tubular-Health/mobius/commit/6d71f530782709ea7302a7c5cf675db2a3e47160))

## [1.2.0](https://github.com/Tubular-Health/mobius/compare/mobius-ai-v1.1.1...mobius-ai-v1.2.0) (2026-01-27)


### Features

* **doctor:** add comprehensive runtime validation checks ([#14](https://github.com/Tubular-Health/mobius/issues/14)) ([34b014c](https://github.com/Tubular-Health/mobius/commit/34b014cfa648d603c53e1562dda91c636ae27780))
* **jira:** migrate Jira integration to Atlassian marketplace plugin ([#22](https://github.com/Tubular-Health/mobius/issues/22)) ([8421925](https://github.com/Tubular-Health/mobius/commit/8421925183e54dce7ede222458912e9e3f8ed322))
* **skills:** add PR creation skill with structured template ([#13](https://github.com/Tubular-Health/mobius/issues/13)) ([a619ebb](https://github.com/Tubular-Health/mobius/commit/a619ebb16ce68aaf5aac0b94596f0f52858ce2ac))
* **skills:** enhance task definition and refinement skills with structured verification ([#15](https://github.com/Tubular-Health/mobius/issues/15)) ([406c25c](https://github.com/Tubular-Health/mobius/commit/406c25cd11e4cf3ae6a6412ba8a7cbdbe32d6691))
* **tui:** add exit confirmation modal with tmux session cleanup ([#23](https://github.com/Tubular-Health/mobius/issues/23)) ([bb7ece5](https://github.com/Tubular-Health/mobius/commit/bb7ece5414141910cebf4193737f54316907a3a1))
* **tui:** add Jira backend support for TUI dashboard ([#24](https://github.com/Tubular-Health/mobius/issues/24)) ([d46ef6a](https://github.com/Tubular-Health/mobius/commit/d46ef6a5b503991db1ef93b9116cea0b73c31c39))


### Bug Fixes

* **loop:** prevent incorrect task failure marking during parallel execution ([#16](https://github.com/Tubular-Health/mobius/issues/16)) ([8dc1d62](https://github.com/Tubular-Health/mobius/commit/8dc1d629eecad2f025086646fe5dff9b441f23ae))
* resolve state file race conditions and display failed tasks correctly ([#7](https://github.com/Tubular-Health/mobius/issues/7)) ([ff9de56](https://github.com/Tubular-Health/mobius/commit/ff9de56ea4e2fa5cff84da7930077998ebe084ed))
* **tui:** correctly resolve blocker status using runtime overrides ([#17](https://github.com/Tubular-Health/mobius/issues/17)) ([9f52718](https://github.com/Tubular-Health/mobius/commit/9f52718af728e8f49421fecd0cdc028ba9430c60))


### Documentation

* **readme:** overhaul README with TUI Dashboard documentation and workflow lifecycle ([#19](https://github.com/Tubular-Health/mobius/issues/19)) ([4514170](https://github.com/Tubular-Health/mobius/commit/451417057faf599fd58578d6456276712da7ff5a))


### Miscellaneous Chores

* consolidate npm publish into release-please workflow ([#10](https://github.com/Tubular-Health/mobius/issues/10)) ([4438c51](https://github.com/Tubular-Health/mobius/commit/4438c514d773128a0872041eb83813e485e911c0))
* **main:** release mobius-loop 1.0.1 ([#4](https://github.com/Tubular-Health/mobius/issues/4)) ([fa247b4](https://github.com/Tubular-Health/mobius/commit/fa247b4e51dd1a6d01d567490043eaf6b97dee07))
* **main:** release mobius-loop 1.1.0 ([#8](https://github.com/Tubular-Health/mobius/issues/8)) ([c563ba0](https://github.com/Tubular-Health/mobius/commit/c563ba05d19a2ffa7faa5b88d6cdf3dccf0bf8a8))
* **main:** release mobius-loop 1.1.1 ([#18](https://github.com/Tubular-Health/mobius/issues/18)) ([bb10b77](https://github.com/Tubular-Health/mobius/commit/bb10b77c89d0158712d936a25928f05e40da7fd5))
* rename package from mobius-loop to mobius-ai ([#20](https://github.com/Tubular-Health/mobius/issues/20)) ([a261763](https://github.com/Tubular-Health/mobius/commit/a2617630db9abdb07656f92f987ce6c1a9d483ce))
* rename package to mobius-loop for npm publishing ([8126391](https://github.com/Tubular-Health/mobius/commit/81263919b7630a16d5fca9206ed59ac96a7d7c35))
* update package name to @tubular/mobius for npm publishing ([e50165d](https://github.com/Tubular-Health/mobius/commit/e50165db15d60cb02a47269ea28245fe3162e04c))

## [1.1.1](https://github.com/Tubular-Health/mobius/compare/mobius-ai-v1.1.0...mobius-ai-v1.1.1) (2026-01-27)


### Bug Fixes

* **tui:** correctly resolve blocker status using runtime overrides ([#17](https://github.com/Tubular-Health/mobius/issues/17)) ([9f52718](https://github.com/Tubular-Health/mobius/commit/9f52718af728e8f49421fecd0cdc028ba9430c60))


### Documentation

* **readme:** overhaul README with TUI Dashboard documentation and workflow lifecycle ([#19](https://github.com/Tubular-Health/mobius/issues/19)) ([4514170](https://github.com/Tubular-Health/mobius/commit/451417057faf599fd58578d6456276712da7ff5a))

## [1.1.0](https://github.com/Tubular-Health/mobius/compare/mobius-ai-v1.0.1...mobius-ai-v1.1.0) (2026-01-26)


### Features

* **doctor:** add comprehensive runtime validation checks ([#14](https://github.com/Tubular-Health/mobius/issues/14)) ([34b014c](https://github.com/Tubular-Health/mobius/commit/34b014cfa648d603c53e1562dda91c636ae27780))
* **skills:** add PR creation skill with structured template ([#13](https://github.com/Tubular-Health/mobius/issues/13)) ([a619ebb](https://github.com/Tubular-Health/mobius/commit/a619ebb16ce68aaf5aac0b94596f0f52858ce2ac))
* **skills:** enhance task definition and refinement skills with structured verification ([#15](https://github.com/Tubular-Health/mobius/issues/15)) ([406c25c](https://github.com/Tubular-Health/mobius/commit/406c25cd11e4cf3ae6a6412ba8a7cbdbe32d6691))


### Bug Fixes

* **loop:** prevent incorrect task failure marking during parallel execution ([#16](https://github.com/Tubular-Health/mobius/issues/16)) ([8dc1d62](https://github.com/Tubular-Health/mobius/commit/8dc1d629eecad2f025086646fe5dff9b441f23ae))
* resolve state file race conditions and display failed tasks correctly ([#7](https://github.com/Tubular-Health/mobius/issues/7)) ([ff9de56](https://github.com/Tubular-Health/mobius/commit/ff9de56ea4e2fa5cff84da7930077998ebe084ed))


### Miscellaneous Chores

* consolidate npm publish into release-please workflow ([#10](https://github.com/Tubular-Health/mobius/issues/10)) ([4438c51](https://github.com/Tubular-Health/mobius/commit/4438c514d773128a0872041eb83813e485e911c0))

## [1.0.1](https://github.com/Tubular-Health/mobius/compare/mobius-ai-v1.0.0...mobius-ai-v1.0.1) (2026-01-26)


### Miscellaneous Chores

* rename package to mobius-ai for npm publishing ([8126391](https://github.com/Tubular-Health/mobius/commit/81263919b7630a16d5fca9206ed59ac96a7d7c35))
* update package name to @tubular/mobius for npm publishing ([e50165d](https://github.com/Tubular-Health/mobius/commit/e50165db15d60cb02a47269ea28245fe3162e04c))
