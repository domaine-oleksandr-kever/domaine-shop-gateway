# Demo seed data

Run these `query` tool calls through the gateway once per store, as a user with role `dev` or
`store-admin` (the bootstrap admin qualifies). Every operation was checked against the Admin API
2026-10 schema. Do the steps in order on `kever-oleksandr-dev-store`, then repeat with
`"store": "kever-b2b"`.

Result on each store: definition `custom.engraving` on products; "Signet Ring" with engraving
"Forever"; "Plain Band" without it; "Hidden Pendant" active but not published to the Online
Store. All three carry the tag `gateway-demo`.

## 1. Metafield definition `custom.engraving`

```json
{
  "store": "kever-oleksandr-dev-store",
  "query": "mutation CreateEngravingDefinition($definition: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $definition) { createdDefinition { id namespace key type { name } } userErrors { field message code } } }",
  "variables": {
    "definition": {
      "name": "Engraving",
      "namespace": "custom",
      "key": "engraving",
      "type": "single_line_text_field",
      "ownerType": "PRODUCT"
    }
  }
}
```

A `TAKEN` user error on the second run means the definition already exists.

## 2. Products

Run once per product; note each returned `product.id`.

```json
{
  "store": "kever-oleksandr-dev-store",
  "query": "mutation CreateProduct($product: ProductCreateInput!) { productCreate(product: $product) { product { id title handle status } userErrors { field message } } }",
  "variables": { "product": { "title": "Signet Ring", "status": "ACTIVE", "tags": ["gateway-demo"] } }
}
```

```json
{
  "store": "kever-oleksandr-dev-store",
  "query": "mutation CreateProduct($product: ProductCreateInput!) { productCreate(product: $product) { product { id title handle status } userErrors { field message } } }",
  "variables": { "product": { "title": "Plain Band", "status": "ACTIVE", "tags": ["gateway-demo"] } }
}
```

```json
{
  "store": "kever-oleksandr-dev-store",
  "query": "mutation CreateProduct($product: ProductCreateInput!) { productCreate(product: $product) { product { id title handle status } userErrors { field message } } }",
  "variables": { "product": { "title": "Hidden Pendant", "status": "ACTIVE", "tags": ["gateway-demo"] } }
}
```

`productCreate` does not publish to any sales channel, so "Hidden Pendant" stays unpublished.

## 3. Engraving on Signet Ring

Replace `<SIGNET_RING_ID>` with the id from step 2.

```json
{
  "store": "kever-oleksandr-dev-store",
  "query": "mutation SetEngraving($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id namespace key type value } userErrors { field message code } } }",
  "variables": {
    "metafields": [
      {
        "ownerId": "<SIGNET_RING_ID>",
        "namespace": "custom",
        "key": "engraving",
        "type": "single_line_text_field",
        "value": "Forever"
      }
    ]
  }
}
```

## 4. Publish Signet Ring and Plain Band to the Online Store

Find the Online Store publication id:

```json
{
  "store": "kever-oleksandr-dev-store",
  "query": "query Publications { publications(first: 10) { nodes { id catalog { title } } } }"
}
```

Then publish each of the two products (not Hidden Pendant):

```json
{
  "store": "kever-oleksandr-dev-store",
  "query": "mutation Publish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { publishable { ... on Product { id title } } userErrors { field message } } }",
  "variables": { "id": "<PRODUCT_ID>", "input": [{ "publicationId": "<ONLINE_STORE_PUBLICATION_ID>" }] }
}
```

`publishablePublish` needs the `write_publications` scope, which the app does not request today.
Without it Shopify answers `ACCESS_DENIED`: add the scope to the app TOML and reinstall, or
publish the two products from the Shopify admin.

## 5. Read back

```json
{
  "store": "kever-oleksandr-dev-store",
  "query": "query EngravingProducts { products(first: 10, query: \"tag:gateway-demo\") { nodes { id title handle status onlineStoreUrl engraving: metafield(namespace: \"custom\", key: \"engraving\") { type value } } pageInfo { hasNextPage endCursor } } }"
}
```

Expected: Signet Ring with `engraving.value` "Forever" and an `onlineStoreUrl`; Plain Band with
`engraving: null`; Hidden Pendant with `onlineStoreUrl: null`.
