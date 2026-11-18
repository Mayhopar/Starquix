import type { ContentCollection } from './types';
import { contentOps } from './content-ops';

/** Create a welcome post, write content config, and notify listeners. */
export async function createCollectionOnDisk(
  collectionName: string,
  collection: ContentCollection,
): Promise<void> {
  await contentOps.createPost(collectionName, 'welcome-to-your-blog', {
    title: 'Welcome to your blog',
    date: new Date().toISOString().split('T')[0],
    description: 'This is a sample blog post',
    thumbnail: '/images/placeholder.jpg',
  }, '\nYour first blog post content goes here.\n').catch(() => {});

  await contentOps.writeContentConfig([collection]).catch(() => {});
}
