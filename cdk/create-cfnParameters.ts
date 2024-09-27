import { CfnParameter } from "aws-cdk-lib";
import { Construct } from "constructs";
import { ResourceConstants } from "graphql-transformer-common";
import { FieldList, TypesenseServerConfig } from "../directive-args";

export const TYPESENSE_PARAMS = {
  typesenseApiKey: "TypesenseApiKey",
  typesenseHost: "TypesenseHost",
  typesensePort: "TypesensePort",
  typesenseProtocol: "TypesenseProtocol",
  typesenseFieldsMap: "TypesenseFieldsMap",
};

export const createParametersStack = (
  stack: Construct,
  serverSettings: TypesenseServerConfig,
  fieldSettings: Record<string, string>,
  defaultFields?: Record<string, FieldList>
): Map<string, CfnParameter> => {
  const {
    OpenSearchAccessIAMRoleName,
    OpenSearchStreamingFunctionName,
    OpenSearchStreamingIAMRoleName,
  } = ResourceConstants.PARAMETERS;

  return new Map<string, CfnParameter>([
    [
      TYPESENSE_PARAMS.typesenseApiKey,
      new CfnParameter(stack, TYPESENSE_PARAMS.typesenseApiKey, {
        description: "Typesense App ID.",
        default: `${serverSettings.apiKey}`,
      }),
    ],

    [
      TYPESENSE_PARAMS.typesenseHost,
      new CfnParameter(stack, TYPESENSE_PARAMS.typesenseHost, {
        description: "Typesense Host.",
        default: `${serverSettings.host}`,
      }),
    ],

    [
      TYPESENSE_PARAMS.typesensePort,
      new CfnParameter(stack, TYPESENSE_PARAMS.typesensePort, {
        description: "Typesense Port.",
        default: `${serverSettings.port}`,
      }),
    ],

    [
      TYPESENSE_PARAMS.typesenseProtocol,
      new CfnParameter(stack, TYPESENSE_PARAMS.typesenseProtocol, {
        description: "Typesense Protocol.",
        default: `${serverSettings.protocol}`,
      }),
    ],

    [
      TYPESENSE_PARAMS.typesenseFieldsMap,
      new CfnParameter(stack, TYPESENSE_PARAMS.typesenseFieldsMap, {
        description: "Typesense Fields Map.",
        default: JSON.stringify({
          fieldSettings,
          defaultFields,
        }),
      }),
    ],

    [
      OpenSearchAccessIAMRoleName,
      new CfnParameter(stack, OpenSearchAccessIAMRoleName, {
        description:
          "The name of the IAM role assumed by AppSync for OpenSearch.",
        default: "AppSyncOpenSearchRole",
      }),
    ],

    [
      OpenSearchStreamingFunctionName,
      new CfnParameter(stack, OpenSearchStreamingFunctionName, {
        description: "The name of the streaming lambda function.",
        default: "DdbToEsFn",
      }),
    ],

    [
      OpenSearchStreamingIAMRoleName,
      new CfnParameter(stack, OpenSearchStreamingIAMRoleName, {
        description: "The name of the streaming lambda function IAM role.",
        default: "SearchLambdaIAMRole",
      }),
    ],
  ]);
};
