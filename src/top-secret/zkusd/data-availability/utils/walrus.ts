const daemon: 'local' | 'testnet' = 'testnet' as 'local' | 'testnet';
const basePublisherUrl =
  daemon === 'local'
    ? 'http://127.0.0.1:31417'
    : 'https://publisher.walrus-testnet.walrus.space';
const readerUrl =
  daemon === 'local'
    ? 'http://127.0.0.1:31417/v1/blobs/'
    : 'https://aggregator.walrus-testnet.walrus.space/v1/blobs/';

const MIN_EPOCHS = 2;
const MAX_EPOCHS = 53;

export async function saveToWalrus({
  data,
  address,
  numBlocks = 2,
}: {
  data: string;
  address?: string;
  numBlocks?: number;
}): Promise<string | undefined> {
  let sendToParam = address ? `&send_object_to=${address}` : '';
  let blocks =
    numBlocks < MIN_EPOCHS
      ? MIN_EPOCHS
      : numBlocks > MAX_EPOCHS
        ? MAX_EPOCHS
        : numBlocks;
  console.log('Writing to Walrus');
  console.time('written');
  const response = await fetch(
    `${basePublisherUrl}/v1/blobs?blocks=${blocks}${sendToParam}`,
    {
      method: 'PUT',
      body: data,
    }
  );
  console.timeEnd('written');
  if (response.status === 200) {
    const info = await response.json();
    console.log('info', info);
    const blobId =
      info?.newlyCreated?.blobObject?.blobId ?? info?.alreadyCertified?.blobId;
    console.log('Walrus blobId', blobId);
    return blobId;
  } else {
    console.error('saveToDA failed:', {
      statusText: response.statusText,
      status: response.status,
    });
    return undefined;
  }
}

export async function readFromWalrus({
  blobId,
}: {
  blobId: string;
}): Promise<string | undefined> {
  if (!blobId) {
    throw new Error('blobId is not provided');
  }
  console.log('Reading walrus blob', blobId);
  console.time('read');
  const response = await fetch(`${readerUrl}${blobId}`);
  console.timeEnd('read');
  if (!response.ok) {
    console.error('readFromDA failed:', {
      statusText: response.statusText,
      status: response.status,
    });
    return undefined;
  } else {
    const blob = await response.text();
    console.log('blob', blob);
    return blob;
  }
}

export async function getWalrusUrl(params: {
  blobId: string;
}): Promise<string> {
  const { blobId } = params;
  if (!blobId) {
    throw new Error('blobId is not set');
  }
  const url = `${readerUrl}${blobId}`;
  return url;
}
