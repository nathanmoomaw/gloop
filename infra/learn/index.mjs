import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { BatchWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { createHandler } from './handler.mjs'

const TABLE_NAME = process.env.TABLE_NAME || 'gloop-learn'
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || 'https://gloop.obfusco.us,https://gloop-dev.obfusco.us'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}))

// PutRequest on the same (day, id) key overwrites identically, so client
// resends (e.g. sendBeacon on page close) are idempotent.
async function writeItems(items) {
  for (let i = 0; i < items.length; i += 25) {
    // Deduplicate within a 25-item batch because BatchWriteItem rejects duplicate keys in one call.
    const seen = new Map()
    for (const item of items.slice(i, i + 25)) {
      seen.set(`${item.day}:${item.id}`, item)
    }
    let requestItems = {
      [TABLE_NAME]: [...seen.values()].map((Item) => ({ PutRequest: { Item } })),
    }
    for (let attempt = 0; attempt <= 5; attempt++) {
      const res = await doc.send(new BatchWriteCommand({ RequestItems: requestItems }))
      const left = res.UnprocessedItems?.[TABLE_NAME]
      if (!left || left.length === 0) {
        requestItems = null
        break
      }
      requestItems = { [TABLE_NAME]: left }
      if (attempt < 5) {
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt))
      }
    }
    if (requestItems) throw new Error('unprocessed items')
  }
}

export const handler = createHandler({ writeItems, allowedOrigins: ALLOWED_ORIGINS })
