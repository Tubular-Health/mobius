# Parallel Research Phase

Use this approach when:
- Issue affects 5+ files across multiple directories
- Multiple subsystems are involved
- Deep domain knowledge is required

## Parallel Agent Prompts

Spawn up to 3 simultaneously:

### Agent 1: Architecture Analysis

```
Task tool:
  subagent_type: Explore
  prompt: |
    For implementing "{issue title}":
    1. How is similar functionality currently implemented?
    2. What architectural patterns are used in this area?
    3. What are the key abstractions and interfaces?
    4. Are there existing utilities that should be reused?
```

### Agent 2: Dependency Mapping

```
Task tool:
  subagent_type: Explore
  prompt: |
    For implementing "{issue title}":
    1. What files will need to import new code?
    2. What existing exports will need modification?
    3. Are there circular dependency risks?
    4. What test utilities exist for mocking these dependencies?
```

### Agent 3: Test & Error Analysis

```
Task tool:
  subagent_type: Explore
  prompt: |
    For implementing "{issue title}":
    1. What test patterns exist for similar features?
    2. What error handling patterns are used?
    3. What could go wrong during implementation?
    4. Are there known pitfalls in this area of the codebase?
```

## Aggregation Strategy

After parallel agents complete, synthesize their findings:

1. **Merge file lists** - Combine all affected files from each agent, deduplicate
2. **Resolve conflicts** - If agents suggest different patterns, prefer the most recent/common pattern
3. **Build dependency graph** - Use Agent 2's output as the foundation
4. **Annotate with risks** - Add Agent 3's pitfalls as "Avoid" items in sub-tasks
5. **Create unified context brief** - Single document for the decomposition phase

### Synthesized Research Brief Template

```markdown
## Synthesized Research Brief

### Files Affected (merged from all agents)
- `src/services/feature.ts` - Create (Agent 1, 2)
- `src/types/feature.ts` - Create (Agent 1)
- `src/hooks/useFeature.ts` - Create (Agent 2)
- `src/components/Feature.tsx` - Modify (Agent 1, 3)

### Patterns to Follow (from Agent 1)
- Service pattern: Follow `src/services/auth.ts` structure
- Hook pattern: Match `src/hooks/useAuth.ts` conventions

### Dependency Notes (from Agent 2)
- New service must be exported from `src/services/index.ts`
- Hook will import from service, component from hook

### Pitfalls to Avoid (from Agent 3)
- Don't forget SSR safety checks (window undefined)
- Similar feature had race condition - use AbortController
- Test file must mock the external API dependency
```

## When NOT to Use Parallel Research

- Simple features (< 4 files)
- Well-understood areas of the codebase
- Time-sensitive changes where sequential is faster
- When agents would query overlapping areas (redundant work)
