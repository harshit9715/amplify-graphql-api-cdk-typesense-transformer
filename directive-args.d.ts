export interface FieldList {
  include?: [string];
  exclude?: [string];
  obfuscate?: [string];
  extraDateFields?: [string];
}
export interface TypesenseDirectiveArgs {
  fields?: FieldList;
  settings?: string;
}

export interface TypesenseServerConfig {
  host: string;
  port: string;
  protocol: string;
  apiKey: string;
}
