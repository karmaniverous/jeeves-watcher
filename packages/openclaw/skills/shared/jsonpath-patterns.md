## JSONPath Patterns for Schema Discovery

Use `watcher_query` to explore the merged virtual document. Common patterns:

### Orientation
```
$.inferenceRules[*].['name','description']    — List all rules with descriptions
$.search.scoreThresholds                       — Score interpretation thresholds
$.slots                                        — Named filter patterns (e.g., memory)
```

### Schema Discovery
```
$.inferenceRules[?(@.name=='jira-issue')]               — Full rule details
$.inferenceRules[?(@.name=='jira-issue')].values        — Distinct values for a rule
$.inferenceRules[?(@.name=='jira-issue')].values.status — Values for a specific field
```

### Helper Enumeration
```
$.mapHelpers                        — All JsonMap helper namespaces
$.mapHelpers.slack.exports          — Exports from the 'slack' helper
$.templateHelpers                   — All Handlebars helper namespaces
```

### Issues
```
$.issues                            — All runtime embedding failures
```

### Full Config Introspection
```
$.schemas                           — Global named schemas
$.maps                              — Named JsonMap transforms
$.templates                         — Named Handlebars templates
```
