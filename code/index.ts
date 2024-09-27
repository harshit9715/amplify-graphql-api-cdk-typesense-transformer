import { unmarshall } from "@aws-sdk/util-dynamodb";
import Typesense from "typesense";

const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY;
const TYPESENSE_HOST = process.env.TYPESENSE_HOST;
const TYPESENSE_PORT = process.env.TYPESENSE_PORT;
const TYPESENSE_PROTOCOL = process.env.TYPESENSE_PROTOCOL;
const TYPESENSE_FIELDS_MAP = process.env.TYPESENSE_FIELDS_MAP;
const typesenseClient = new Typesense.Client({
  nodes: [
    {
      host: TYPESENSE_HOST as string,
      port: parseInt(TYPESENSE_PORT as string),
      protocol: TYPESENSE_PROTOCOL as string,
    },
  ],
  apiKey: TYPESENSE_API_KEY as string ,
  connectionTimeoutSeconds: 5,
});

/* DB event example
{
    "Records": [
        {
            "eventID": "75c6d0774736d13b7ecd133f35da0a22",
            "eventName": "INSERT",
            "eventVersion": "1.1",
            "eventSource": "aws:dynamodb",
            "awsRegion": "us-east-1",
            "dynamodb": {
                "ApproximateCreationDateTime": 1694805859,
                "Keys": {
                    "id": {
                        "S": "e5855fc0-0ad5-4de3-8f2b-2a28168a352a"
                    }
                },
                "NewImage": {
                    "createdAt": {
                        "S": "2023-09-15T19:24:19.368Z"
                    },
                    "_lastChangedAt": {
                        "N": "1694805859393"
                    },
                    "__typename": {
                        "S": "Blog"
                    },
                    "name": {
                        "S": "lets go1"
                    },
                    "id": {
                        "S": "e5855fc0-0ad5-4de3-8f2b-2a28168a352a"
                    },
                    "_version": {
                        "N": "1"
                    },
                    "updatedAt": {
                        "S": "2023-09-15T19:24:19.368Z"
                    }
                },
                "SequenceNumber": "4841800000000015978594257",
                "SizeBytes": 200,
                "StreamViewType": "NEW_AND_OLD_IMAGES"
            },
            "eventSourceARN": "arn:aws:dynamodb:us-east-1:446581856886:table/Blog-mp6xr657pvbpjbyd4nqbvk44du-dev/stream/2023-09-14T15:08:09.233"
        }
    ]
}
*/

/* AppSync query example
"{\"typeName\":\"Query\",\"tableName\":\"Blog-mp6xr657pvbpjbyd4nqbvk44du-dev\",\"arguments\":\"{\\\"searchParameters\\\":{\\\"q\\\":\\\"text\\\",\\\"query_by\\\":\\\"name\\\",\\\"filter_by\\\":\\\"num_comments:>100\\\",\\\"sort_by\\\":\\\"num_comments:desc\\\"}}\"}"

*/

export const handler = async (event: any) => {
  try {
    if (event.Records) {
      return handleDbEvent(event);
    } else if (typeof event === "string" && event.includes("typeName")) {
      return handleAppSyncQuery(JSON.parse(event)).then((result) => {
        console.log(JSON.stringify(result, null, 2));
        return JSON.stringify(result);
      });
    } else {
      throw new Error("Unknown event type");
    }
  } catch (error) {
    console.error(error);
  }
};

const handleDateFields = (modelName: string, docFields: any) => {
  const newDocFields = { ...docFields };
  const { defaultFields } = JSON.parse(TYPESENSE_FIELDS_MAP as string);
  const extraDateFields = defaultFields[modelName]?.extraDateFields || [];

  for (const key of Object.keys(docFields)) {
    if (
      ["updatedAt", "createdAt", ...extraDateFields].includes(key) &&
      !isNaN(Date.parse(docFields[key]))
    ) {
      const date = new Date(docFields[key]);

      // Create new fields
      newDocFields[`${key}Year`] = date.getUTCFullYear().toString();
      newDocFields[`${key}Month`] =
        `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      newDocFields[`${key}Day`] =
        `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
      newDocFields[`${key}Hour`] = String(date.getUTCHours()).padStart(2, "0");
    }
  }
  return newDocFields;
};

const handleDbEvent = async (event: any) => {
  const operations = event.Records.map((record: any) => {
    const ddb = record.dynamodb;
    const tableName = record.eventSourceARN.split(":")[5].split("/")[1];
    const modelName = tableName.split("-")[0];
    const rawDoc = ddb.NewImage || ddb.OldImage;
    const docFields = handleDateFields(modelName, unmarshall(rawDoc));

    return {
      action:
        record.eventName === "INSERT" ||
        (record.eventName === "MODIFY" && !docFields._deleted)
          ? "upsert"
          : "delete",
      collectionName: tableName.toLowerCase(),
      document: {
        ...docFields,
      },
      rawDoc,
    };
  });
  const collectionCache: any = {};
  await Promise.all(
    operations.map(async (op: any) => {
      if (op.action === "upsert") {
        if (!collectionCache[op.collectionName]) {
          collectionCache[op.collectionName] = await typesenseClient
            .collections()
            .retrieve()
            .then((collections) =>
              collections.some(
                (collection) => collection.name === op.collectionName
              )
            );
        }
        if (!collectionCache[op.collectionName]) {
          const schema: any = {
            name: op.collectionName,
            enable_nested_fields: true,
            fields: [{ name: ".*", type: "auto" }],
          };
          await typesenseClient.collections().create(schema);
          collectionCache[op.collectionName] = true;
        }
        await typesenseClient
          .collections(op.collectionName)
          .documents()
          .upsert(op.document);
      } else if (op.action === "delete") {
        await typesenseClient
          .collections(op.collectionName)
          .documents(op.document.id)
          .delete();
      }
    })
  );
};

const handleAppSyncQuery = (event: any) => {
  let collectionName: string;
  const parsedArguments = JSON.parse(event.arguments);

  if (event.fieldName === "rawSearch") {
    collectionName = parsedArguments.collection.toLowerCase();
  } else {
    collectionName = event.tableName.toLowerCase();
  }

  const collection = typesenseClient.collections(collectionName);
  return collection.documents().search(parsedArguments.searchParameters);
};
