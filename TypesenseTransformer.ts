import {
  DirectiveWrapper,
  generateGetArgumentsInput,
  InvalidDirectiveError,
  isSqlModel,
  TransformerPluginBase,
} from "@aws-amplify/graphql-transformer-core";

import {
  TransformerContextProvider,
  TransformerPrepareStepContextProvider,
  TransformerSchemaVisitStepContextProvider,
} from "@aws-amplify/graphql-transformer-interfaces";

import {
  CfnDataSource,
  CfnResolver,
  DynamoDbDataSource,
  LambdaDataSource,
} from "aws-cdk-lib/aws-appsync";

import { Table } from "aws-cdk-lib/aws-dynamodb";
import { IFunction } from "aws-cdk-lib/aws-lambda";

import { CfnCondition, Fn } from "aws-cdk-lib";

import { IConstruct } from "constructs";
import { DirectiveNode, ObjectTypeDefinitionNode } from "graphql";

import {
  blankObject,
  blankObjectExtension,
  extensionWithFields,
  graphqlName,
  makeDirective,
  makeField,
  makeInputObjectDefinition,
  makeInputValueDefinition,
  makeListType,
  makeNamedType,
  makeNonNullType,
  ModelResourceIDs,
  plurality,
  ResourceConstants,
  toUpper,
} from "graphql-transformer-common";

import { createParametersStack as createParametersInStack } from "./cdk/create-cfnParameters";
import { setMappings } from "./cdk/create-layer-cfnMapping";
import {
  createEventSourceMapping,
  createLambda,
  createLambdaRole,
} from "./cdk/create-streaming-lambda";

import {
  FieldList,
  TypesenseDirectiveArgs,
  TypesenseServerConfig,
} from "./directive-args";

const STACK_NAME = "TypesenseStack";
const API_KEY_DIRECTIVE = "aws_api_key";
const AWS_IAM_DIRECTIVE = "aws_iam";
const OIDC_DIRECTIVE = "aws_oidc";
const AMAZON_COGNITO_USER_POOLS_DIRECTIVE = "aws_cognito_user_pools";
const directiveName = "typesense";
const RESPONSE_MAPPING_TEMPLATE = `
  #if( $ctx.error )
    $util.error($ctx.error.message, $ctx.error.type)
  #else
    $ctx.result
  #end
  `;

interface SearchableObjectTypeDefinition {
  node: ObjectTypeDefinitionNode;
  fieldName: string;
  fieldNameRaw: string;
  directiveArguments: TypesenseDirectiveArgs;
}

const createParametersMap = (
  searchableObjectTypeDefinitions: SearchableObjectTypeDefinition[]
) => {
  const defaultFieldParams = searchableObjectTypeDefinitions.reduce(
    (acc, { fieldNameRaw, directiveArguments }: any) => {
      return { [fieldNameRaw]: directiveArguments.fields, ...acc };
    },
    {} as Record<string, FieldList>
  );
  const defaultSettingsParams = searchableObjectTypeDefinitions.reduce(
    (acc, { fieldNameRaw, directiveArguments }: any) => {
      return { [fieldNameRaw]: directiveArguments.settings, ...acc };
    },
    {} as Record<string, string>
  );
  return { defaultFieldParams, defaultSettingsParams };
};

const generateTypesenseXConnectionType = (
  ctx: TransformerSchemaVisitStepContextProvider,
  definition: ObjectTypeDefinitionNode
): void => {
  const searchableXConnectionName = `Searchable${definition.name.value}Connection`;
  if (ctx.output.hasType(searchableXConnectionName)) {
    return;
  }

  // Create the Hit type
  const hitTypeName = `${definition.name.value}Hit`;
  const hitType = blankObject(hitTypeName);
  ctx.output.addObject(hitType);

  // Add fields to the Hit type
  let hitTypeExtension = blankObjectExtension(hitTypeName);
  hitTypeExtension = extensionWithFields(hitTypeExtension, [
    makeField(
      "document",
      [],
      makeNonNullType(makeNamedType(definition.name.value))
    ),
    makeField(
      "highlights",
      [],
      makeNonNullType(makeListType(makeNamedType("TypesenseHighlights")))
    ),
    makeField("text_match", [], makeNamedType("Float")), // Assuming `text_match` is AWSJSON
    makeField("text_match_info", [], makeNamedType("TypesenseTextMatchInfo")),
  ]);
  ctx.output.addObjectExtension(hitTypeExtension);

  const groupedHitTypeName = `${definition.name.value}GroupedHit`;
  const groupedHitType = blankObject(groupedHitTypeName);
  ctx.output.addObject(groupedHitType);

  let groupedHitTypeExtension = blankObjectExtension(groupedHitTypeName);
  groupedHitTypeExtension = extensionWithFields(groupedHitTypeExtension, [
    makeField("found", [], makeNamedType("Int")),
    makeField("group_key", [], makeListType(makeNamedType("String"))),
    makeField("hits", [], makeListType(makeNamedType(hitTypeName))),
  ]);
  ctx.output.addObjectExtension(groupedHitTypeExtension);

  // Create the TableXConnection
  const connectionType = blankObject(searchableXConnectionName);
  ctx.output.addObject(connectionType);

  // Create TableXConnection type with items and nextToken
  let connectionTypeExtension = blankObjectExtension(searchableXConnectionName);
  connectionTypeExtension = extensionWithFields(connectionTypeExtension, [
    makeField("hits", [], makeListType(makeNamedType(hitTypeName))),
  ]);

  connectionTypeExtension = extensionWithFields(connectionTypeExtension, [
    makeField("facet_counts", [], makeListType(makeNamedType("AWSJSON"))),
    makeField("found", [], makeNamedType("Int")),
    makeField("found_docs", [], makeNamedType("Int")),
    makeField(
      "grouped_hits",
      [],
      makeListType(makeNamedType(groupedHitTypeName))
    ),
    makeField("out_of", [], makeNamedType("Int")),
    makeField("page", [], makeNamedType("Int")),
    makeField("search_time_ms", [], makeNamedType("Int")),
    makeField("search_cutoff", [], makeNamedType("Boolean")),
    makeField("request_params", [], makeNonNullType(makeNamedType("AWSJSON"))),
  ]);
  ctx.output.addObjectExtension(connectionTypeExtension);
};

const generateTypesenseHitTextMatchInfoType = (
  ctx: TransformerSchemaVisitStepContextProvider
): string => {
  const textMatchInfo = "TypesenseTextMatchInfo";
  if (ctx.output.hasType(textMatchInfo)) {
    return textMatchInfo;
  }

  const textMatchInfoType = blankObject(textMatchInfo);
  ctx.output.addObject(textMatchInfoType);
  let textMatchInfoTypeExtension = blankObjectExtension(textMatchInfo);
  textMatchInfoTypeExtension = extensionWithFields(textMatchInfoTypeExtension, [
    makeField("best_field_score", [], makeNamedType("String")),
    makeField("best_field_weight", [], makeNamedType("Int")),
    makeField("fields_matched", [], makeNamedType("Int")),
    makeField("num_tokens_dropped", [], makeNamedType("Int")),
    makeField("score", [], makeNamedType("String")),
    makeField("tokens_matched", [], makeNamedType("Int")),
    makeField("typo_prefix_score", [], makeNamedType("Int")),
  ]);
  ctx.output.addObjectExtension(textMatchInfoTypeExtension);
  return textMatchInfo;
};

const generateTypesenseHitHighlightsType = (
  ctx: TransformerSchemaVisitStepContextProvider
): string => {
  const highlights = "TypesenseHighlights";
  if (ctx.output.hasType(highlights)) {
    return highlights;
  }

  const highlightsType = blankObject(highlights);
  ctx.output.addObject(highlightsType);
  let highlightsTypeExtension = blankObjectExtension(highlights);
  highlightsTypeExtension = extensionWithFields(highlightsTypeExtension, [
    makeField("field", [], makeNamedType("String")),
    makeField("matched_tokens", [], makeListType(makeNamedType("String"))),
    makeField("snippet", [], makeNamedType("String")),
  ]);
  ctx.output.addObjectExtension(highlightsTypeExtension);
  return highlights;
};

const generateTypesenseSearchInput = (
  ctx: TransformerSchemaVisitStepContextProvider
): void => {
  const typesenseSearchInput = "TypesenseSearchInput";

  // Check if the input type already exists
  if (ctx.output.hasType(typesenseSearchInput)) {
    return;
  }

  // Create the input type using makeInputObjectDefinition
  const typesenseSearchInputType = makeInputObjectDefinition(
    typesenseSearchInput,
    [
      makeInputValueDefinition("q", makeNonNullType(makeNamedType("String"))),
      makeInputValueDefinition(
        "query_by",
        makeNonNullType(makeNamedType("String"))
      ),
      makeInputValueDefinition("filter_by", makeNamedType("String")),
      makeInputValueDefinition("sort_by", makeNamedType("String")),
      makeInputValueDefinition("group_by", makeNamedType("String")),
      makeInputValueDefinition("group_limit", makeNamedType("Int")),
      makeInputValueDefinition("facet_by", makeNamedType("String")),
      makeInputValueDefinition("prefix", makeNamedType("Boolean")),
      makeInputValueDefinition("page", makeNamedType("Int")),
      makeInputValueDefinition("per_page", makeNamedType("Int")),
      makeInputValueDefinition("include_fields", makeNamedType("String")),
      makeInputValueDefinition("exclude_fields", makeNamedType("String")),
      makeInputValueDefinition(
        "highlight_full_fields",
        makeNamedType("String")
      ),
      makeInputValueDefinition(
        "highlight_affix_num_tokens",
        makeNamedType("Int")
      ),
      makeInputValueDefinition("highlight_start_tag", makeNamedType("String")),
      makeInputValueDefinition("highlight_end_tag", makeNamedType("String")),
      makeInputValueDefinition("snippet_threshold", makeNamedType("Int")),
      makeInputValueDefinition("drop_tokens_threshold", makeNamedType("Int")),
      makeInputValueDefinition("typo_tokens_threshold", makeNamedType("Int")),
      makeInputValueDefinition("limit_hits", makeNamedType("Int")),
    ]
  );
  // Add the input type to the schema
  ctx.output.addInput(typesenseSearchInputType);
};

const generateTypesenseAggregateTypes = (
  ctx: TransformerSchemaVisitStepContextProvider
): void => {
  generateTypesenseHitTextMatchInfoType(ctx);
  generateTypesenseHitHighlightsType(ctx);
  generateTypesenseSearchInput(ctx);
};

export class TypesenseTransformer extends TransformerPluginBase {
  searchableObjectTypeDefinitions: SearchableObjectTypeDefinition[];
  searchableObjectNames: string[];
  stage: string;
  config: TypesenseServerConfig;
  constructor(stage: string, config: TypesenseServerConfig) {
    super(
      "amplify-graphql-typesense-transformer",
      /* GraphQL */ `
          directive @${directiveName}(fields: FieldList, settings: AWSJSON) on OBJECT
          input FieldList {
            include: [String]
            exclude: [String]
            obfuscate: [String]
            extraDateFields: [String]
          }
        `
    );
    this.stage = stage;
    this.config = config;
    this.searchableObjectTypeDefinitions = [];
    this.searchableObjectNames = [];
  }

  private isTypesenseConfigured(): boolean {
    return this.searchableObjectNames.length !== 0;
  }

  generateResolvers = (context: TransformerContextProvider): void => {
    if (!this.isTypesenseConfigured()) {
      return;
    }

    const { Env } = ResourceConstants.PARAMETERS;
    const { HasEnvironmentParameter } = ResourceConstants.CONDITIONS;

    const stack = context.stackManager.createStack(STACK_NAME);

    setMappings(stack);
    createCondition(stack, context, Env, HasEnvironmentParameter, this.stage);

    stack.templateOptions.description =
      "An auto-generated nested stack for typesense.";
    stack.templateOptions.templateFormatVersion = "2010-09-09";

    const { defaultFieldParams, defaultSettingsParams } = createParametersMap(
      this.searchableObjectTypeDefinitions
    );
    const parameterMap = createParametersInStack(
      stack.node.scope!,
      this.config,
      defaultSettingsParams,
      defaultFieldParams
    );

    const lambdaRole = createLambdaRole(context, stack, parameterMap);
    const lambda = createLambda(stack, context.api, parameterMap, lambdaRole);

    const dataSource = context.api.host.addLambdaDataSource(
      `searchResolverDataSource`,
      lambda,
      {},
      stack
    );

    createSourceMappings(
      this.searchableObjectTypeDefinitions,
      context,
      lambda,
      dataSource
    );
  };

  object = (
    definition: ObjectTypeDefinitionNode,
    directive: DirectiveNode,
    ctx: TransformerSchemaVisitStepContextProvider
  ): void => {
    let shouldMakeSearch = true;
    let searchFieldNameOverride;

    validateModelDirective(definition);
    const hasAuth =
      definition.directives?.some((dir) => dir.name.value === "auth") ?? false;
    const directiveArguments = getDirectiveArguments(directive, ctx) as any;
    if (directiveArguments.queries) {
      if (!directiveArguments.queries.search) {
        shouldMakeSearch = false;
      } else {
        searchFieldNameOverride = directiveArguments.queries.search;
      }
    }
    const fieldName =
      searchFieldNameOverride ??
      graphqlName(`search${plurality(toUpper(definition.name.value), true)}`);
    this.searchableObjectTypeDefinitions.push({
      node: definition,
      fieldName,
      fieldNameRaw: definition.name.value,
      directiveArguments,
    });

    if (shouldMakeSearch) {
      this.searchableObjectNames.push(definition.name.value);
      generateTypesenseXConnectionType(ctx, definition);
      generateTypesenseAggregateTypes(ctx);
      const directives = [];
      if (!hasAuth) {
        if (
          ctx.transformParameters.sandboxModeEnabled &&
          ctx.synthParameters.enableIamAccess
        ) {
          // If both sandbox and iam access are enabled we add service directive regardless of default.
          // This is because any explicit directive makes default not applicable to a model.
          directives.push(makeDirective(API_KEY_DIRECTIVE, []));
          directives.push(makeDirective(AWS_IAM_DIRECTIVE, []));
        } else if (
          ctx.transformParameters.sandboxModeEnabled &&
          ctx.authConfig.defaultAuthentication.authenticationType !== "API_KEY"
        ) {
          directives.push(makeDirective(API_KEY_DIRECTIVE, []));
        } else if (
          ctx.synthParameters.enableIamAccess &&
          ctx.authConfig.defaultAuthentication.authenticationType !== "AWS_IAM"
        ) {
          directives.push(makeDirective(AWS_IAM_DIRECTIVE, []));
        } else if (
          ctx.authConfig.defaultAuthentication.authenticationType ===
          "OPENID_CONNECT"
        ) {
          directives.push(makeDirective(OIDC_DIRECTIVE, []));
        } else if (
          ctx.authConfig.defaultAuthentication.authenticationType ===
          "AMAZON_COGNITO_USER_POOLS"
        ) {
          directives.push(
            makeDirective(AMAZON_COGNITO_USER_POOLS_DIRECTIVE, [])
          );
        }
      }
      const queryField = makeField(
        fieldName,
        [
          makeInputValueDefinition(
            "searchParameters",
            makeNonNullType(makeNamedType("TypesenseSearchInput"))
          ),
        ],
        makeNamedType(`Searchable${definition.name.value}Connection`),
        directives
      );

      // Add the new rawSearch query
      const queryType = ctx.output.getType("Query") as ObjectTypeDefinitionNode | undefined;
      const rawSearchExists = queryType?.fields?.some(field => field.name.value === "rawSearch");

      if (!rawSearchExists) {
        const rawSearchField = makeField(
          "rawSearch",
          [
            makeInputValueDefinition(
              "searchParameters",
              makeNonNullType(makeNamedType("TypesenseSearchInput"))
            ),
            makeInputValueDefinition(
              "collection",
              makeNonNullType(makeNamedType("String"))
            ),
          ],
          makeNonNullType(makeNamedType("AWSJSON")),
          directives
        );
        ctx.output.addQueryFields([rawSearchField]);
      }
      ctx.output.addQueryFields([queryField]);
    }
  };

  prepare = (ctx: TransformerPrepareStepContextProvider): void => {
    // register search query resolvers in field mapping
    // if no mappings are registered elsewhere, this won't do anything
    // but if mappings are defined this will ensure the mapping is also applied to the search results
    for (const def of this.searchableObjectTypeDefinitions) {
      const modelName = def.node.name.value;
      if (isSqlModel(ctx as TransformerContextProvider, modelName)) {
        throw new InvalidDirectiveError(
          `@typesense is not supported on "${modelName}" model as it uses RDS datasource.`
        );
      }
      ctx.resourceHelper.getModelFieldMap(modelName).addResolverReference({
        typeName: "Query",
        fieldName: def.fieldName,
        isList: true,
      });
    }
  };

  // transformSchema = (
  //   ctx: TransformerTransformSchemaStepContextProvider
  // ): void => {
  //   //? add api key to aggregate types if sandbox mode is enabled
  //   if (
  //     this.isTypesenseConfigured() &&
  //     ctx.transformParameters.sandboxModeEnabled &&
  //     ctx.authConfig.defaultAuthentication.authenticationType !== "API_KEY"
  //   ) {
  //
  //   }
  // };
}

const createCondition = (
  stack: any,
  context: any,
  Env: any,
  HasEnvironmentParameter: any,
  stage: string
) => {
  const envParam = stage;
  new CfnCondition(stack, HasEnvironmentParameter, {
    expression: Fn.conditionNot(
      Fn.conditionEquals(envParam, ResourceConstants.NONE)
    ),
  });
};

const validateModelDirective = (object: ObjectTypeDefinitionNode): void => {
  const modelDirective = object.directives!.find(
    (dir) => dir.name.value === "model"
  );
  if (!modelDirective) {
    throw new InvalidDirectiveError(
      `Types annotated with @${directiveName} must also be annotated with @model.`
    );
  }
};

const getTable = (
  context: TransformerContextProvider,
  definition: any // ObjectTypeDefinitionNode
): { table: IConstruct; tableConfig: CfnDataSource.DynamoDBConfigProperty } => {
  const ddbDataSource = context.dataSources.get(
    definition
  ) as DynamoDbDataSource;
  const tableName = ModelResourceIDs.ModelTableResourceID(
    definition.name.value
  );
  const table = ddbDataSource.ds.stack.node.findChild(tableName);
  return {
    table,
    tableConfig: ddbDataSource.ds
      .dynamoDbConfig as CfnDataSource.DynamoDBConfigProperty,
  };
};

const getDirectiveArguments = (
  directive: any, // DirectiveNode,
  ctx: TransformerSchemaVisitStepContextProvider
): TypesenseDirectiveArgs => {
  const directiveWrapped = new DirectiveWrapper(directive);
  return directiveWrapped.getArguments(
    {},
    generateGetArgumentsInput(ctx.transformParameters)
  ) as any;
};

const createSourceMappings = (
  searchableObjectTypeDefinitions: SearchableObjectTypeDefinition[],
  context: TransformerContextProvider,
  lambda: IFunction,
  lambdaDataSource: LambdaDataSource
): void => {
  const stack = context.stackManager.getStack(STACK_NAME);
  
  // Add the rawSearch resolver
  const rawSearchResolver = new CfnResolver(
    stack,
    `rawSearchResolver`,
    {
      apiId: context.api.apiId,
      fieldName: "rawSearch",
      typeName: "Query",
      kind: "UNIT",
      dataSourceName: lambdaDataSource?.ds.attrName,
      requestMappingTemplate: getRawSearchRequestMappingTemplate(),
      responseMappingTemplate: RESPONSE_MAPPING_TEMPLATE,
    }
  );
  context.api.addSchemaDependency(rawSearchResolver);

  for (const def of searchableObjectTypeDefinitions) {
    const type = def.node.name.value;
    const openSearchIndexName =
      context.resourceHelper.getModelNameMapping(type);
    const tableData = getTable(context, def.node);
    const ddbTable = tableData.table as Table;
    if (!ddbTable) {
      throw new Error("Failed to find ddb table for searchable");
    }

    ddbTable.grantStreamRead(lambda.role!);

    if (!ddbTable.tableStreamArn) {
      throw new Error(
        "tableStreamArn is required on ddb table ot create event source mappings"
      );
    }
    createEventSourceMapping(
      stack,
      openSearchIndexName,
      lambda,
      ddbTable.tableStreamArn
    );

    const resolver = new CfnResolver(
      stack,
      `${def.fieldNameRaw}SearchResolver`,
      {
        apiId: context.api.apiId,
        fieldName: def.fieldName,
        typeName: "Query",
        kind: "UNIT",
        dataSourceName: lambdaDataSource?.ds.attrName,
        requestMappingTemplate: getRequestMappingTemplate(
          tableData.tableConfig.tableName
        ),
        responseMappingTemplate: RESPONSE_MAPPING_TEMPLATE,
      }
    );
    context.api.addSchemaDependency(resolver);
  }
};

const getRequestMappingTemplate = (tableName: string) => `
  $util.toJson({ "version": "2018-05-29", "operation": "Invoke", "payload": $util.toJson({ "typeName": "Query", "tableName": "${tableName}", "arguments": $util.toJson($ctx.args), "identity": $utils.toJson($ctx.identity), "source": $utils.toJson($ctx.source) }) })
  `;

const getRawSearchRequestMappingTemplate = () => `
  $util.toJson({
    "version": "2018-05-29",
    "operation": "Invoke",
    "payload": $util.toJson({
      "typeName": "Query",
      "fieldName": "rawSearch",
      "arguments": $util.toJson($ctx.args),
      "identity": $utils.toJson($ctx.identity),
      "source": $utils.toJson($ctx.source)
    })
  })
`;
