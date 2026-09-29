import { getCollection } from 'astro:content';

/** The posts to show: every one in dev, only the published ones in a build. */
export const livePosts = () => getCollection('locations', ({ data }) => import.meta.env.DEV || data.published);
