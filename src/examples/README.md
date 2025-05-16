# Flow Examples

This directory contains example flows demonstrating various patterns and use cases for the JSON-RPC Flow schema.

## Examples

1. **Simple Request (01-simple-request.json)**

   - Basic request flow with parameter substitution
   - Demonstrates context usage and step result references
   - Shows simple dependency chain between steps

2. **Data Transformation (02-data-transformation.json)**

   - Various data transformation operations
   - Filter, map, and reduce operations
   - Chaining multiple transformations

3. **Nested Loops (03-nested-loops.json)**

   - Complex iteration patterns
   - Nested loop structures
   - Accessing parent loop variables

4. **Conditional Branching (04-conditional-branching.json)**

   - Conditional execution logic
   - Different paths based on conditions
   - Nested operations within conditions

5. **Complex Data Pipeline (05-complex-data-pipeline.json)**
   - Complete data processing pipeline
   - Combines all primitive operations
   - Shows real-world usage patterns
   - Error handling and data validation

## Key Concepts Demonstrated

### Data Dependencies

- Steps reference results from previous steps using `${stepName.property}` syntax
- Execution order is determined by data dependencies
- Context variables available globally using `${context.property}`

### Control Flow

- Loops for iteration over collections
- Conditions for branching logic
- Nested operations for complex workflows

### Data Transformation

- Filter operations for data selection
- Map operations for data transformation
- Reduce operations for aggregation
- Chaining multiple operations

### Best Practices

- Clear step naming
- Proper error handling
- Modular step design
- Efficient data processing

## Usage

Each example includes a `$schema` field referencing `../meta-schema.json` and can be validated using:

```bash
ajv validate -s ../meta-schema.json -d example.json
```

The examples are designed to be self-contained and can be used as templates for building your own flows.
