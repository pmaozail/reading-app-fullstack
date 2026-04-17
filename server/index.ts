import {randomUUID} from 'node:crypto';
import {posix as pathPosix} from 'node:path';
import {config as loadEnv} from 'dotenv';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import iconv from 'iconv-lite';
import JSZip from 'jszip';
import {XMLParser} from 'fast-xml-parser';
import {decode as decodeHtml} from 'html-entities';
import {createClient} from '@supabase/supabase-js';
import {
  INITIAL_BOOKSHELF,
  INITIAL_LIBRARY,
  type BookRecord,
  type LibraryBook,
} from './data';

type DbBookRow = {
  id: string;
  title: string;
  author: string;
  cover: string;
  progress: number;
  status: BookRecord['status'];
  category: string;
  is_archived: boolean;
  description: string[] | null;
  publisher: string | null;
  size: string | null;
  pages: number | null;
  publish_date: string | null;
  author_en: string | null;
  rating: number | null;
  reviews: number | null;
  created_at: string;
};

type DbBookFileRow = {
  book_id: string;
  file_type: 'txt' | 'epub';
  file_path: string;
  text_content: string | null;
  text_encoding: string | null;
};

type ApiError = {code?: string; message?: string; details?: string | null};
type DbReadingProgressRow = {
  book_id: string;
  chapter_index: number;
  total_chapters: number;
  scroll_percent: number | null;
  updated_at: string;
};

type ParsedChapter = {
  id: string;
  title: string;
  text: string;
  level?: number;
};

type ParsedBookChapters = {
  chapters: ParsedChapter[];
  coverDataUrl?: string;
  bookTitle?: string;
  bookAuthor?: string;
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

loadEnv({path: '.env.local'});
loadEnv();

const PORT = Number(process.env.PORT || 8787);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = process.env.SUPABASE_BOOKS_BUCKET || 'books';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const app = express();
const upload = multer({storage: multer.memoryStorage(), limits: {fileSize: 50 * 1024 * 1024}});

app.use(cors());
app.use(express.json({limit: '2mb'}));

const epubChapterCache = new Map<string, ParsedBookChapters>();

const cleanObject = <T extends Record<string, unknown>>(obj: T): Partial<T> =>
  Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as Partial<T>;

const toApiBook = (row: DbBookRow, fileRow?: DbBookFileRow): BookRecord => ({
  id: row.id,
  title: row.title,
  author: row.author,
  cover: row.cover,
  progress: row.progress,
  status: row.status,
  category: row.category,
  isArchived: row.is_archived,
  description: row.description ?? undefined,
  publisher: row.publisher ?? undefined,
  size: row.size ?? undefined,
  pages: row.pages ?? undefined,
  publishDate: row.publish_date ?? undefined,
  authorEn: row.author_en ?? undefined,
  rating: row.rating ?? undefined,
  reviews: row.reviews ?? undefined,
  fileType: fileRow?.file_type,
  filePath: fileRow?.file_path,
  textContent: fileRow?.text_content ?? undefined,
  textEncoding: fileRow?.text_encoding ?? undefined,
});

const toDbBook = (book: Partial<BookRecord>) =>
  cleanObject({
    id: book.id,
    title: book.title,
    author: book.author,
    cover: book.cover,
    progress: book.progress,
    status: book.status,
    category: book.category,
    is_archived: book.isArchived,
    description: book.description,
    publisher: book.publisher,
    size: book.size,
    pages: book.pages,
    publish_date: book.publishDate,
    author_en: book.authorEn,
    rating: book.rating,
    reviews: book.reviews,
  });

const replacementRatio = (text: string) => {
  if (!text.length) return 1;
  const bad = (text.match(/\uFFFD/g) || []).length;
  return bad / text.length;
};

const decodeTxtBuffer = (buffer: Buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {text: iconv.decode(buffer.slice(3), 'utf8'), encoding: 'utf8-bom'};
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return {text: iconv.decode(buffer.slice(2), 'utf16le'), encoding: 'utf16le-bom'};
  }

  const utf8Text = iconv.decode(buffer, 'utf8');
  if (replacementRatio(utf8Text) < 0.001) {
    return {text: utf8Text, encoding: 'utf8'};
  }

  const gbText = iconv.decode(buffer, 'gb18030');
  if (replacementRatio(gbText) < replacementRatio(utf8Text)) {
    return {text: gbText, encoding: 'gb18030'};
  }

  return {text: utf8Text, encoding: 'utf8-fallback'};
};

const decodeTextBuffer = (buffer: Buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {text: iconv.decode(buffer.slice(3), 'utf8'), encoding: 'utf8-bom'};
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return {text: iconv.decode(buffer.slice(2), 'utf16le'), encoding: 'utf16le-bom'};
  }

  const latinHead = buffer.subarray(0, 1024).toString('latin1');
  const encodingMatch = latinHead.match(/encoding=["']([^"']+)["']/i);
  if (encodingMatch?.[1]) {
    const declared = encodingMatch[1].toLowerCase();
    const normalized =
      declared === 'gbk' || declared === 'gb2312' || declared === 'gb18030'
        ? 'gb18030'
        : declared === 'utf-8'
          ? 'utf8'
          : declared === 'utf-16'
            ? 'utf16le'
            : declared;
    if (iconv.encodingExists(normalized)) {
      return {text: iconv.decode(buffer, normalized), encoding: normalized};
    }
  }

  const utf8Text = iconv.decode(buffer, 'utf8');
  const gbText = iconv.decode(buffer, 'gb18030');
  return replacementRatio(gbText) < replacementRatio(utf8Text)
    ? {text: gbText, encoding: 'gb18030'}
    : {text: utf8Text, encoding: 'utf8'};
};

const decodePossiblyLatin1Filename = (name: string) => {
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return replacementRatio(decoded) <= replacementRatio(name) ? decoded : name;
  } catch {
    return name;
  }
};

const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

const stripHtmlToText = (html: string) =>
  decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );

const splitLongParagraph = (text: string, maxLen = 220) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  if (normalized.length <= maxLen) return [normalized];

  const parts = normalized.split(/([。！？；!?;])/).filter(Boolean);
  const result: string[] = [];
  let current = '';
  for (let i = 0; i < parts.length; i += 1) {
    const piece = parts[i];
    if (current.length + piece.length > maxLen && current.length > 0) {
      result.push(current.trim());
      current = '';
    }
    current += piece;
  }
  if (current.trim()) result.push(current.trim());
  return result.length > 0 ? result : [normalized];
};

const firstMatch = (content: string, regex: RegExp) => {
  const m = content.match(regex);
  return m?.[1] ? decodeHtml(m[1].replace(/<[^>]+>/g, '').trim()) : '';
};

const normalizeToArray = <T,>(value: T | T[] | undefined): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const resolveHref = (basePath: string, href: string) => {
  const noFragment = href.split('#')[0];
  return pathPosix.normalize(pathPosix.join(basePath, noFragment));
};

const getEpubCoverDataUrl = async (
  zip: JSZip,
  baseDir: string,
  metadataNode: unknown,
  manifest: Array<Record<string, string>>
) => {
  const metadataItems = normalizeToArray(metadataNode as Record<string, unknown> | Record<string, unknown>[]);
  let coverIdFromMeta = '';
  for (const node of metadataItems) {
    if ((node['@_name'] || '').toString().toLowerCase() === 'cover' && node['@_content']) {
      coverIdFromMeta = node['@_content'].toString();
      break;
    }
  }

  let coverItem =
    (coverIdFromMeta ? manifest.find((item) => item['@_id'] === coverIdFromMeta) : undefined) ||
    manifest.find((item) => (item['@_properties'] || '').split(' ').includes('cover-image')) ||
    manifest.find((item) => (item['@_id'] || '').toLowerCase().includes('cover'));

  if (!coverItem?.['@_href']) {
    return undefined;
  }

  const coverPath = resolveHref(baseDir, coverItem['@_href']);
  const coverEntry = zip.file(coverPath);
  if (!coverEntry) return undefined;

  const coverBuffer = await coverEntry.async('nodebuffer');
  if (coverBuffer.byteLength > 2 * 1024 * 1024) {
    return undefined;
  }

  const mediaType = coverItem['@_media-type'] || 'image/jpeg';
  return `data:${mediaType};base64,${coverBuffer.toString('base64')}`;
};

const parseEpubChapters = async (buffer: Buffer): Promise<ParsedBookChapters> => {
  const zip = await JSZip.loadAsync(buffer);
  const containerEntry = zip.file('META-INF/container.xml');
  if (!containerEntry) {
    throw new Error('Invalid EPUB: META-INF/container.xml not found');
  }

  const containerXml = decodeTextBuffer(await containerEntry.async('nodebuffer')).text;
  const containerParsed = xmlParser.parse(containerXml) as {
    container?: {rootfiles?: {rootfile?: {['@_full-path']?: string} | Array<{['@_full-path']?: string}>}};
  };

  const rootfiles = normalizeToArray(containerParsed.container?.rootfiles?.rootfile);
  const rootfilePath = rootfiles[0]?.['@_full-path'];
  if (!rootfilePath) {
    throw new Error('Invalid EPUB: rootfile path missing');
  }

  const opfEntry = zip.file(rootfilePath);
  if (!opfEntry) {
    throw new Error(`Invalid EPUB: OPF file not found (${rootfilePath})`);
  }

  const opfXml = decodeTextBuffer(await opfEntry.async('nodebuffer')).text;
  const opfParsed = xmlParser.parse(opfXml) as {
    package?: {
      metadata?: Record<string, unknown>;
      manifest?: {item?: Array<Record<string, string>> | Record<string, string>};
      spine?: {itemref?: Array<Record<string, string>> | Record<string, string>};
    };
  };

  const manifest = normalizeToArray(opfParsed.package?.manifest?.item);
  const spine = normalizeToArray(opfParsed.package?.spine?.itemref);
  const baseDir = pathPosix.dirname(rootfilePath);

  const manifestMap = new Map<string, Record<string, string>>();
  for (const item of manifest) {
    if (item['@_id']) manifestMap.set(item['@_id'], item);
  }

  const navItem = manifest.find((item) => (item['@_properties'] || '').split(' ').includes('nav'));
  const tocMap = new Map<string, string>();

  if (navItem?.['@_href']) {
    const navPath = resolveHref(baseDir, navItem['@_href']);
    const navEntry = zip.file(navPath);
    if (navEntry) {
      const navHtml = decodeTextBuffer(await navEntry.async('nodebuffer')).text;
      const anchorRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = anchorRegex.exec(navHtml))) {
        const href = resolveHref(pathPosix.dirname(navPath), m[1]);
        const title = decodeHtml(m[2].replace(/<[^>]+>/g, '').trim());
        if (href && title) tocMap.set(href, title);
      }
    }
  }

  const coverDataUrl = await getEpubCoverDataUrl(
    zip,
    baseDir,
    opfParsed.package?.metadata?.meta,
    manifest
  );

  const epubTitle =
    firstMatch(opfXml, /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i) ||
    firstMatch(opfXml, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const epubAuthor = firstMatch(opfXml, /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);

  const chapters: ParsedChapter[] = [];

  for (let i = 0; i < spine.length; i += 1) {
    const idref = spine[i]['@_idref'];
    if (!idref) continue;

    const item = manifestMap.get(idref);
    if (!item?.['@_href']) continue;

    const chapterPath = resolveHref(baseDir, item['@_href']);
    const chapterFile = zip.file(chapterPath);
    if (!chapterFile) continue;

    const chapterHtml = decodeTextBuffer(await chapterFile.async('nodebuffer')).text;
    const titleFromHtml =
      firstMatch(chapterHtml, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
      firstMatch(chapterHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      firstMatch(chapterHtml, /<h2[^>]*>([\s\S]*?)<\/h2>/i);

    const title = tocMap.get(chapterPath) || titleFromHtml || `Chapter ${i + 1}`;

    const contentBlocks: Array<{tag: string; text: string}> = [];
    const blockRegex = /<(h[1-6]|p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = blockRegex.exec(chapterHtml))) {
      const tag = blockMatch[1].toLowerCase();
      const text = decodeHtml(blockMatch[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      if (text) {
        contentBlocks.push({tag, text});
      }
    }

    if (contentBlocks.length === 0) {
      const fallback = splitLongParagraph(stripHtmlToText(chapterHtml)).join('\n\n');
      if (fallback) {
        chapters.push({
          id: `chapter-${chapters.length + 1}`,
          title,
          text: fallback,
          level: 1,
        });
      }
      continue;
    }

    let currentTitle = title;
    let currentParagraphs: string[] = [];
    let currentLevel = 1;

    const flush = () => {
      if (currentParagraphs.length === 0) return;
      chapters.push({
        id: `chapter-${chapters.length + 1}`,
        title: currentTitle,
        text: currentParagraphs.join('\n\n'),
        level: currentLevel,
      });
      currentParagraphs = [];
    };

    for (const block of contentBlocks) {
      if (/^h[1-6]$/.test(block.tag)) {
        flush();
        currentTitle = block.text || currentTitle;
        currentLevel = Number(block.tag.slice(1));
        continue;
      }

      const segmented = splitLongParagraph(block.text);
      currentParagraphs.push(...segmented);
    }

    flush();
  }

  const chapterList =
    chapters.length > 0
      ? chapters
      : [{id: 'chapter-1', title: epubTitle || 'Content', text: 'No readable chapter content found.', level: 1}];

  if (epubTitle && chapterList[0]) {
    chapterList[0].title = chapterList[0].title || epubTitle;
  }

  return {
    chapters: chapterList,
    coverDataUrl,
    bookTitle: epubTitle || undefined,
    bookAuthor: epubAuthor || undefined,
  };
};

const isMissingBookFilesTable = (error: unknown) => {
  const err = error as ApiError;
  return err?.code === 'PGRST205' && (err?.message || '').includes('book_files');
};

const isMissingReadingProgressTable = (error: unknown) => {
  const err = error as ApiError;
  return err?.code === 'PGRST205' && (err?.message || '').includes('reading_progress');
};
const isMissingScrollPercentColumn = (error: unknown) => {
  const err = error as ApiError;
  return err?.code === 'PGRST204' && (err?.message || '').includes('scroll_percent');
};

const localProgressCache = new Map<string, {chapterIndex: number; scrollPercent: number}>();

const ensureStorageBucket = async () => {
  const {data, error} = await supabase.storage.getBucket(STORAGE_BUCKET);
  if (!error && data) return;

  const {error: createError} = await supabase.storage.createBucket(STORAGE_BUCKET, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
  });
  if (createError && !createError.message.toLowerCase().includes('already exists')) {
    throw createError;
  }
};

const getBookFilesMap = async (bookIds: string[]) => {
  if (bookIds.length === 0) return new Map<string, DbBookFileRow>();

  const {data, error} = await supabase.from('book_files').select('*').in('book_id', bookIds);
  if (error) {
    if (isMissingBookFilesTable(error)) return new Map<string, DbBookFileRow>();
    throw error;
  }

  return new Map((data as DbBookFileRow[]).map((row) => [row.book_id, row]));
};

const removeBookFileResources = async (bookId: string) => {
  const {data: fileRow, error: fileLookupError} = await supabase
    .from('book_files')
    .select('*')
    .eq('book_id', bookId)
    .maybeSingle();

  if (!fileLookupError) {
    if ((fileRow as {file_path?: string} | null)?.file_path) {
      await supabase.storage.from(STORAGE_BUCKET).remove([(fileRow as {file_path: string}).file_path]);
    }
    await supabase.from('book_files').delete().eq('book_id', bookId);
  }

  epubChapterCache.delete(bookId);
  localProgressCache.delete(bookId);
  const {error: progressDeleteError} = await supabase.from('reading_progress').delete().eq('book_id', bookId);
  if (progressDeleteError && !isMissingReadingProgressTable(progressDeleteError)) {
    throw progressDeleteError;
  }
};

const getReadingProgress = async (bookId: string) => {
  const {data, error} = await supabase
    .from('reading_progress')
    .select('*')
    .eq('book_id', bookId)
    .maybeSingle();

  if (error) {
    if (isMissingReadingProgressTable(error)) {
      const cached = localProgressCache.get(bookId) ?? {chapterIndex: 0, scrollPercent: 0};
      return {chapterIndex: cached.chapterIndex, scrollPercent: cached.scrollPercent};
    }
    throw error;
  }

  if (!data) {
    const cached = localProgressCache.get(bookId) ?? {chapterIndex: 0, scrollPercent: 0};
    return {chapterIndex: cached.chapterIndex, scrollPercent: cached.scrollPercent};
  }

  const row = data as DbReadingProgressRow;
  const cached = localProgressCache.get(bookId);
  return {
    chapterIndex: row.chapter_index ?? 0,
    scrollPercent: Math.min(
      100,
      Math.max(0, Number(row.scroll_percent ?? cached?.scrollPercent ?? 0))
    ),
  };
};

const saveReadingProgress = async (
  bookId: string,
  chapterIndex: number,
  totalChapters: number,
  scrollPercent: number
) => {
  const safeScroll = Math.min(100, Math.max(0, Number.isFinite(scrollPercent) ? scrollPercent : 0));
  localProgressCache.set(bookId, {chapterIndex, scrollPercent: safeScroll});

  const {error} = await supabase.from('reading_progress').upsert(
    {
      book_id: bookId,
      chapter_index: chapterIndex,
      total_chapters: totalChapters,
      scroll_percent: safeScroll,
      updated_at: new Date().toISOString(),
    },
    {onConflict: 'book_id'}
  );

  if (error) {
    if (isMissingReadingProgressTable(error)) {
      return;
    }
    if (isMissingScrollPercentColumn(error)) {
      const {error: fallbackError} = await supabase.from('reading_progress').upsert(
        {
          book_id: bookId,
          chapter_index: chapterIndex,
          total_chapters: totalChapters,
          updated_at: new Date().toISOString(),
        },
        {onConflict: 'book_id'}
      );
      if (!fallbackError || isMissingReadingProgressTable(fallbackError)) {
        return;
      }
      throw fallbackError;
    }
    throw error;
  }
};

const ensureSeeded = async () => {
  const {count: shelfCount, error: shelfError} = await supabase
    .from('bookshelf_books')
    .select('*', {count: 'exact', head: true});
  if (shelfError) throw shelfError;

  if ((shelfCount ?? 0) === 0) {
    const {error} = await supabase.from('bookshelf_books').insert(
      INITIAL_BOOKSHELF.map((book) =>
        toDbBook({
          ...book,
          progress: book.progress ?? 0,
          status: book.status ?? 'unread',
          isArchived: book.isArchived ?? false,
        })
      )
    );
    if (error) throw error;
  }

  const {count: libraryCount, error: libraryError} = await supabase
    .from('library_books')
    .select('*', {count: 'exact', head: true});
  if (libraryError) throw libraryError;

  if ((libraryCount ?? 0) === 0) {
    const {error} = await supabase.from('library_books').insert(
      INITIAL_LIBRARY.map((book) =>
        toDbBook({
          ...book,
          progress: 0,
          status: 'unread',
          isArchived: false,
        })
      )
    );
    if (error) throw error;
  }

  const {data: shelfBooks, error: shelfReadError} = await supabase.from('bookshelf_books').select('*');
  if (shelfReadError) throw shelfReadError;

  if ((shelfBooks as DbBookRow[]).length > 0) {
    const {error: syncError} = await supabase
      .from('library_books')
      .upsert((shelfBooks as DbBookRow[]).map((row) => toDbBook(toApiBook(row))), {onConflict: 'id'});
    if (syncError) throw syncError;
  }
};

const checkSupabase = async () => {
  const {error: dbError} = await supabase.from('bookshelf_books').select('id', {head: true, count: 'exact'});
  const {error: filesTableError} = await supabase.from('book_files').select('book_id', {head: true, count: 'exact'});
  const {error: progressTableError} = await supabase
    .from('reading_progress')
    .select('book_id', {head: true, count: 'exact'});

  try {
    await ensureStorageBucket();
  } catch {
    // fallback to status reporting below
  }

  const {data: bucketData, error: bucketError} = await supabase.storage.getBucket(STORAGE_BUCKET);

  return {
    database: dbError ? 'error' : 'ok',
    storage: bucketError ? 'error' : 'ok',
    bucketFound: Boolean(bucketData),
    filesTable: filesTableError ? 'error' : 'ok',
    readingProgressTable: progressTableError ? 'error' : 'ok',
    dbError: dbError?.message,
    storageError: bucketError?.message,
    filesTableError: filesTableError?.message,
    readingProgressError: progressTableError?.message,
  };
};

app.get('/api/health', async (_req, res) => {
  try {
    const supabaseStatus = await checkSupabase();
    res.json({ok: true, service: 'book-app-api', supabase: supabaseStatus});
  } catch (error) {
    res.status(500).json({ok: false, service: 'book-app-api', error});
  }
});

app.get('/api/bookshelf', async (_req, res) => {
  try {
    await ensureSeeded();
    const {data, error} = await supabase.from('bookshelf_books').select('*').order('created_at', {ascending: false});
    if (error) throw error;

    const rows = data as DbBookRow[];
    const filesMap = await getBookFilesMap(rows.map((r) => r.id));
    res.json({data: rows.map((row) => toApiBook(row, filesMap.get(row.id)))});
  } catch (error) {
    res.status(500).json({message: 'Failed to fetch bookshelf books', error});
  }
});

app.post('/api/bookshelf', async (req, res) => {
  try {
    const payload = req.body as Partial<BookRecord>;
    if (!payload.id || !payload.title || !payload.author || !payload.cover) {
      res.status(400).json({message: 'id/title/author/cover are required'});
      return;
    }

    const normalizedPayload: Partial<BookRecord> = {
      progress: 0,
      status: 'unread',
      category: 'Uncategorized',
      isArchived: false,
      ...payload,
    };

    const {data, error} = await supabase
      .from('bookshelf_books')
      .upsert(toDbBook(normalizedPayload), {onConflict: 'id'})
      .select('*')
      .single();
    if (error) throw error;

    const {error: librarySyncError} = await supabase
      .from('library_books')
      .upsert(toDbBook(normalizedPayload), {onConflict: 'id'});
    if (librarySyncError) throw librarySyncError;

    const filesMap = await getBookFilesMap([(data as DbBookRow).id]);
    res.status(201).json({data: toApiBook(data as DbBookRow, filesMap.get((data as DbBookRow).id))});
  } catch (error) {
    res.status(500).json({message: 'Failed to create bookshelf book', error});
  }
});

app.post('/api/books/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({message: 'No file uploaded'});
      return;
    }

    const lower = file.originalname.toLowerCase();
    const isTxt = lower.endsWith('.txt');
    const isEpub = lower.endsWith('.epub');
    if (!isTxt && !isEpub) {
      res.status(400).json({message: 'Only .txt and .epub files are supported'});
      return;
    }

    const id = randomUUID();
    const decodedOriginalName = decodePossiblyLatin1Filename(file.originalname);
    let resolvedTitle = decodedOriginalName.replace(/\.[^/.]+$/, '') || `book-${id.slice(0, 8)}`;
    const now = Date.now();
    const filePath = `${isTxt ? 'txt' : 'epub'}/${now}-${safeFileName(decodedOriginalName)}`;

    const {error: uploadError} = await supabase.storage.from(STORAGE_BUCKET).upload(filePath, file.buffer, {
      contentType: file.mimetype || (isTxt ? 'text/plain' : 'application/epub+zip'),
      upsert: true,
    });
    if (uploadError) throw uploadError;

    let decodedText: string | null = null;
    let textEncoding: string | null = null;
    let parsedEpub: ParsedBookChapters | null = null;
    let resolvedCover = 'https://images.unsplash.com/photo-1512820790803-83ca734da794?q=80&w=600&auto=format&fit=crop';
    let resolvedAuthor = 'Unknown Author';

    if (isTxt) {
      const decoded = decodeTxtBuffer(file.buffer);
      decodedText = decoded.text;
      textEncoding = decoded.encoding;
    }
    if (isEpub) {
      parsedEpub = await parseEpubChapters(file.buffer);
      if (parsedEpub.bookTitle && parsedEpub.bookTitle.trim()) {
        resolvedTitle = parsedEpub.bookTitle.trim();
      }
      if (parsedEpub.bookAuthor && parsedEpub.bookAuthor.trim()) {
        resolvedAuthor = parsedEpub.bookAuthor.trim();
      }
      if (parsedEpub.coverDataUrl) {
        resolvedCover = parsedEpub.coverDataUrl;
      }
    }

    const bookInsert = {
      id,
      title: resolvedTitle,
      author: resolvedAuthor,
      cover: resolvedCover,
      progress: 0,
      status: 'unread',
      category: isTxt ? 'TXT' : 'EPUB',
      is_archived: false,
      description: [
        isTxt
          ? `Uploaded TXT file. Encoding: ${textEncoding || 'unknown'}`
          : 'Uploaded EPUB file. Parsed chapters are available in reading mode.',
      ],
      publisher: 'Local Upload',
      size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
    };

    const {data: createdBook, error: createBookError} = await supabase
      .from('bookshelf_books')
      .insert(bookInsert)
      .select('*')
      .single();
    if (createBookError) throw createBookError;

    const {error: librarySyncError} = await supabase.from('library_books').upsert(bookInsert, {onConflict: 'id'});
    if (librarySyncError) throw librarySyncError;

    const fileMetaInsert = {
      book_id: id,
      file_type: isTxt ? 'txt' : 'epub',
      file_path: filePath,
      text_content: decodedText,
      text_encoding: textEncoding,
    };

    const {error: fileMetaError} = await supabase.from('book_files').upsert(fileMetaInsert, {onConflict: 'book_id'});
    if (fileMetaError) {
      await supabase.from('bookshelf_books').delete().eq('id', id);
      await supabase.from('library_books').delete().eq('id', id);
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
      if (isMissingBookFilesTable(fileMetaError)) {
        res.status(500).json({
          message:
            'book_files table is missing. Please run supabase/schema.sql in Supabase SQL Editor, then retry upload.',
        });
        return;
      }
      throw fileMetaError;
    }

    const resultBook = toApiBook(createdBook as DbBookRow, fileMetaInsert as DbBookFileRow);
    if (parsedEpub) {
      const cacheKey = `${id}:${filePath}`;
      epubChapterCache.set(cacheKey, parsedEpub);
    }
    res.status(201).json({data: resultBook});
  } catch (error) {
    res.status(500).json({message: 'Failed to upload file', error});
  }
});

app.get('/api/books/:id/chapters', async (req, res) => {
  try {
    const bookId = req.params.id;

    const {data: fileRow, error} = await supabase
      .from('book_files')
      .select('*')
      .eq('book_id', bookId)
      .maybeSingle();

    if (error) throw error;
    if (!fileRow) {
      res.status(404).json({message: 'No uploaded file found for this book'});
      return;
    }

    const fileMeta = fileRow as DbBookFileRow;

    if (fileMeta.file_type === 'txt') {
      const text = fileMeta.text_content || '';
      const paragraphs = text
        .split(/\r?\n\s*\r?\n/)
        .map((p) => p.trim())
        .filter(Boolean);

      const chunks: ParsedChapter[] = [];
      const chunkSize = 25;
      for (let i = 0; i < paragraphs.length; i += chunkSize) {
        chunks.push({
          id: `chapter-${chunks.length + 1}`,
          title: `Part ${chunks.length + 1}`,
          text: paragraphs.slice(i, i + chunkSize).join('\n\n'),
        });
      }

      res.json({
        data: {
          chapters: chunks.length > 0 ? chunks : [{id: 'chapter-1', title: 'Content', text: text || 'No content'}],
        },
      });
      return;
    }

    const cacheKey = `${bookId}:${fileMeta.file_path}`;
    if (epubChapterCache.has(cacheKey)) {
      res.json({data: epubChapterCache.get(cacheKey)});
      return;
    }

    const {data: blobData, error: downloadError} = await supabase.storage.from(STORAGE_BUCKET).download(fileMeta.file_path);
    if (downloadError) throw downloadError;

    const buffer = Buffer.from(await blobData.arrayBuffer());
    const parsed = await parseEpubChapters(buffer);
    epubChapterCache.set(cacheKey, parsed);

    res.json({data: parsed});
  } catch (error) {
    res.status(500).json({message: 'Failed to parse chapters', error});
  }
});

app.get('/api/books/:id/reading-progress', async (req, res) => {
  try {
    const bookId = req.params.id;
    const progress = await getReadingProgress(bookId);
    res.json({data: progress});
  } catch (error) {
    res.status(500).json({message: 'Failed to get reading progress', error});
  }
});

app.put('/api/books/:id/reading-progress', async (req, res) => {
  try {
    const bookId = req.params.id;
    const chapterIndex = Number(req.body?.chapterIndex ?? 0);
    const totalChapters = Math.max(1, Number(req.body?.totalChapters ?? 1));
    const scrollPercent = Number(req.body?.scrollPercent ?? 0);

    const safeChapterIndex = Number.isFinite(chapterIndex) ? Math.max(0, chapterIndex) : 0;
    const safeScrollPercent = Number.isFinite(scrollPercent)
      ? Math.min(100, Math.max(0, scrollPercent))
      : 0;
    const progressPercent = Math.min(100, Math.max(0, Math.round(((safeChapterIndex + 1) / totalChapters) * 100)));

    await saveReadingProgress(bookId, safeChapterIndex, totalChapters, safeScrollPercent);

    const {error: updateBookError} = await supabase
      .from('bookshelf_books')
      .update({progress: progressPercent})
      .eq('id', bookId);
    if (updateBookError) throw updateBookError;

    const {error: updateLibraryError} = await supabase
      .from('library_books')
      .update({progress: progressPercent})
      .eq('id', bookId);
    if (updateLibraryError) throw updateLibraryError;

    res.json({data: {chapterIndex: safeChapterIndex, scrollPercent: safeScrollPercent, progress: progressPercent}});
  } catch (error) {
    res.status(500).json({message: 'Failed to save reading progress', error});
  }
});

app.patch('/api/bookshelf/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const payload = req.body as Partial<BookRecord>;

    const {data, error} = await supabase
      .from('bookshelf_books')
      .update(toDbBook(payload))
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;

    const filesMap = await getBookFilesMap([id]);
    res.json({data: toApiBook(data as DbBookRow, filesMap.get(id))});
  } catch (error) {
    res.status(500).json({message: 'Failed to update bookshelf book', error});
  }
});

app.delete('/api/bookshelf/:id', async (req, res) => {
  try {
    const id = req.params.id;

    await removeBookFileResources(id);

    const {error} = await supabase.from('bookshelf_books').delete().eq('id', id);
    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    res.status(500).json({message: 'Failed to delete bookshelf book', error});
  }
});

app.get('/api/library', async (_req, res) => {
  try {
    await ensureSeeded();
    const {data, error} = await supabase.from('library_books').select('*').order('created_at', {ascending: false});
    if (error) throw error;

    const rows = data as DbBookRow[];
    const filesMap = await getBookFilesMap(rows.map((r) => r.id));
    res.json({data: rows.map((row) => toApiBook(row, filesMap.get(row.id)) as LibraryBook)});
  } catch (error) {
    res.status(500).json({message: 'Failed to fetch library books', error});
  }
});

app.delete('/api/library/:id', async (req, res) => {
  try {
    const id = req.params.id;

    await removeBookFileResources(id);

    const {error: shelfDeleteError} = await supabase.from('bookshelf_books').delete().eq('id', id);
    if (shelfDeleteError) throw shelfDeleteError;

    const {error: libraryDeleteError} = await supabase.from('library_books').delete().eq('id', id);
    if (libraryDeleteError) throw libraryDeleteError;

    res.status(204).send();
  } catch (error) {
    res.status(500).json({message: 'Failed to delete library book', error});
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
