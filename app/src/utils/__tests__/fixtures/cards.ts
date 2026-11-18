// Imported cards (owner 2026-10-09: "in imported projects it also must work"):
// any entry name (`work.data.x`), Astro's <Image>, multi-line markup.
export const IMPORTED_CARD = `---
import {type CollectionEntry} from "astro:content"
import { Image } from "astro:assets"
type Props = { work: CollectionEntry<"works"> }
const {work} = Astro.props
---
<article class="w-full
mt-[16vh]">
    <a href={\`/works/\${work.slug}\`} class="grow">
        <Image
            src={work.data.image}
            alt={work.data.title}
            width={1340}
            class="w-full object-cover"
            transition:name={"cover:" + work.data.title}
        >
        </Image>
        <div class="flex flex-col">
            <h1 class="font-semibold
            mt-4"
                transition:name={"title:" + work.data.title}>
                {work.data.title}
            </h1>
            <p class="description
            text-gray-700">
                {work.data.description}
            </p>
        </div>
    </a>
</article>
`;
