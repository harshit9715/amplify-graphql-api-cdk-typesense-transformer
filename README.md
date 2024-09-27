# Amplify GraphQL API CDK Typesense Transformer

This package provides a Typesense transformer for AWS AppSync to be used with the AmplifyGraphqlApi construct. It enables seamless integration of Typesense search capabilities into your GraphQL API built with AWS Amplify and CDK.

## Features

- Integrates Typesense search functionality with AWS AppSync
- Supports custom field mapping and settings for Typesense collections
- Automatically syncs DynamoDB data to Typesense
- Provides GraphQL queries for searching Typesense collections
- Typed input for search query and result
- End to end auth integration
- additional rawSearch query for instantsearch.js integration
- Supports custom date fields mapping
## Installation

Install the package using npm:

1. Import the transformer in your CDK stack:

```typescript
import { TypesenseTransformer } from "amplify-graphql-api-cdk-typesense-transformer";
```

2. Add the transformer to your GraphQL API:

```typescript
const typesenseTransformer = new TypesenseTransformer("dev", {
  apiKey: "your-typesense-api-key",
  host: "your-typesense-host",
  port: "your-typesense-port",
  protocol: "https",
});
new AmplifyGraphqlApi(this, "API", {
  // ... other configuration ...
  transformerPlugins: [typesenseTransformer],
});
```

3. Use the `@typesense` directive in your GraphQL schema:

```graphql
type Post @model @typesense {
  id: ID!
  title: String!
  content: String!
}

# Example for a Comment model with default fields and field settings these values are optional and will be made availabe to the lambda function as environment variables and can be used to include or exclude fields from typesense and other custom logic
type Comment @model @typesense(defaultFields: {}, fieldSettings: {}) {
  id: ID!
  content: String!
  postId: ID!
}
```

4. Use the generated search queries in your application:

```typescript
const result = await API.graphql({
  query: searchPosts,
  variables: {
    input: TypesenseSearchInput,
  },
});
```

This package is fully typed with end to end auth. meaning auth rules will be applied on the returned documents from typesense.

To use it with instantsearch.js, with typesense-instant-search-adapter, there is a "rawSearch" query available in the generated schema, it takes collection name and TypesenseSearchInput as input and returns the search results as JSON string.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.
