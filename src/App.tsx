import React, {useEffect, useMemo, useRef, useState} from 'react';

type BookStatus = 'unread' | 'reading' | 'completed';

type AppBook = {
  id: string;
  title: string;
  author: string;
  cover: string;
  progress: number;
  status: BookStatus;
  category: string;
  isArchived: boolean;
  description?: string[];
  publisher?: string;
  size?: string;
  pages?: number;
  publishDate?: string;
  authorEn?: string;
  rating?: number;
  reviews?: number;
  fileType?: 'txt' | 'epub';
  filePath?: string;
  textContent?: string;
  textEncoding?: string;
};

type HealthResponse = {
  ok: boolean;
  service: string;
  supabase?: {
    database: 'ok' | 'error';
    storage: 'ok' | 'error';
    filesTable: 'ok' | 'error';
    readingProgressTable?: 'ok' | 'error';
    bucketFound: boolean;
    dbError?: string;
    storageError?: string;
    filesTableError?: string;
    readingProgressError?: string;
  };
};

type ChaptersResponse = {
  data: {
    chapters: Array<{
      id: string;
      title: string;
      text: string;
      level?: number;
    }>;
  };
};

type ReadingProgressResponse = {
  data: {
    chapterIndex: number;
    scrollPercent?: number;
  };
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

const LOCAL_LIBRARY: AppBook[] = [
  {
    id: 'l1',
    title: 'The Stranger',
    author: 'Albert Camus',
    cover: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?q=80&w=600&auto=format&fit=crop',
    progress: 0,
    status: 'unread',
    category: 'Novel',
    isArchived: false,
    rating: 4.7,
    reviews: 342,
    size: '1.8 MB',
    description: ['A classic novel on absurdity and freedom.'],
  },
  {
    id: 'l2',
    title: 'Sapiens',
    author: 'Yuval Noah Harari',
    cover: 'https://images.unsplash.com/photo-1519682337058-a94d519337bc?q=80&w=600&auto=format&fit=crop',
    progress: 0,
    status: 'unread',
    category: 'History',
    isArchived: false,
    rating: 4.8,
    reviews: 1180,
    size: '3.1 MB',
    description: ['A brief history of humankind.'],
  },
];

const requestJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {'Content-Type': 'application/json'},
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed with ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
};

const uploadFileWithProgress = (file: File, onProgress: (pct: number) => void) =>
  new Promise<AppBook>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/books/upload`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as {data: AppBook};
          resolve(parsed.data);
        } catch (error) {
          reject(error);
        }
        return;
      }
      reject(new Error(xhr.responseText || `Upload failed (${xhr.status})`));
    };

    xhr.onerror = () => reject(new Error('Network error while uploading file'));

    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
  });

export default function App() {
  const [tab, setTab] = useState<'bookshelf' | 'library' | 'profile'>('bookshelf');
  const [view, setView] = useState<'tabs' | 'details' | 'reading'>('tabs');
  const [bookshelf, setBookshelf] = useState<AppBook[]>([]);
  const [library, setLibrary] = useState<AppBook[]>(LOCAL_LIBRARY);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [selectedBook, setSelectedBook] = useState<AppBook | null>(null);

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [backendError, setBackendError] = useState<string>('');

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState('');

  const loadData = async () => {
    setBackendError('');
    try {
      const [healthRes, shelfRes, libraryRes] = await Promise.all([
        requestJson<HealthResponse>('/health'),
        requestJson<{data: AppBook[]}>('/bookshelf'),
        requestJson<{data: AppBook[]}>('/library'),
      ]);
      setHealth(healthRes);
      setBookshelf(shelfRes.data);
      setLibrary(libraryRes.data);
    } catch (error) {
      console.error(error);
      setBackendError(error instanceof Error ? error.message : 'Failed to connect backend');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const visibleBooks = useMemo(() => {
    return bookshelf.filter((b) => {
      const inCategory = category === 'All' || b.category === category;
      const hit =
        b.title.toLowerCase().includes(query.toLowerCase()) ||
        b.author.toLowerCase().includes(query.toLowerCase());
      return !b.isArchived && inCategory && hit;
    });
  }, [bookshelf, category, query]);

  const archivedBooks = bookshelf.filter((b) => b.isArchived);
  const categories = ['All', ...Array.from(new Set(bookshelf.map((b) => b.category || 'Uncategorized')))];

  const openDetails = (book: AppBook) => {
    setSelectedBook(book);
    setView('details');
  };

  const archiveBook = async (bookId: string) => {
    const target = bookshelf.find((b) => b.id === bookId);
    if (!target) return;

    const nextArchived = !target.isArchived;
    setBookshelf((prev) => prev.map((b) => (b.id === bookId ? {...b, isArchived: nextArchived} : b)));

    try {
      await requestJson(`/bookshelf/${bookId}`, {
        method: 'PATCH',
        body: JSON.stringify({isArchived: nextArchived}),
      });
    } catch {
      setBookshelf((prev) => prev.map((b) => (b.id === bookId ? {...b, isArchived: target.isArchived} : b)));
    }
  };

  const deleteBook = async (bookId: string) => {
    const snapshot = bookshelf;
    setBookshelf((prev) => prev.filter((b) => b.id !== bookId));

    try {
      await requestJson(`/bookshelf/${bookId}`, {method: 'DELETE'});
    } catch {
      setBookshelf(snapshot);
    }
  };

  const deleteFromLibrary = async (bookId: string) => {
    const librarySnapshot = library;
    const shelfSnapshot = bookshelf;

    setLibrary((prev) => prev.filter((b) => b.id !== bookId));
    setBookshelf((prev) => prev.filter((b) => b.id !== bookId));

    try {
      await requestJson<void>(`/library/${bookId}`, {method: 'DELETE'});
    } catch (error) {
      setLibrary(librarySnapshot);
      setBookshelf(shelfSnapshot);
      setUploadMessage(error instanceof Error ? error.message : 'Delete failed');
    }
  };

  const downloadBook = async (book: AppBook) => {
    if (bookshelf.some((b) => b.id === book.id)) return;

    const newBook: AppBook = {...book, progress: 0, status: 'unread', isArchived: false};
    setBookshelf((prev) => [newBook, ...prev]);

    try {
      await requestJson('/bookshelf', {
        method: 'POST',
        body: JSON.stringify(newBook),
      });
    } catch {
      setBookshelf((prev) => prev.filter((b) => b.id !== book.id));
      setUploadMessage('Download failed to persist. Check Supabase connection.');
    }
  };

  const handleUploadInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const isSupported = file.name.toLowerCase().endsWith('.txt') || file.name.toLowerCase().endsWith('.epub');
    if (!isSupported) {
      setUploadMessage('Only .txt and .epub are supported.');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadMessage('Uploading...');

    try {
      const uploadedBook = await uploadFileWithProgress(file, setUploadProgress);
      setBookshelf((prev) => [uploadedBook, ...prev]);
      setLibrary((prev) => (prev.some((b) => b.id === uploadedBook.id) ? prev : [uploadedBook, ...prev]));
      setUploadMessage(
        uploadedBook.fileType === 'txt'
          ? `Uploaded TXT successfully (${uploadedBook.textEncoding || 'encoding unknown'})`
          : 'Uploaded EPUB successfully'
      );
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  if (view === 'details' && selectedBook) {
    return (
      <BookDetails
        book={selectedBook}
        isDownloaded={bookshelf.some((b) => b.id === selectedBook.id)}
        onBack={() => setView('tabs')}
        onRead={() => setView('reading')}
        onDownload={() => downloadBook(selectedBook)}
      />
    );
  }

  if (view === 'reading' && selectedBook) {
    return <ReadingView book={selectedBook} onBack={() => setView('details')} />;
  }

  const supabaseOk =
    health?.supabase?.database === 'ok' &&
    health?.supabase?.storage === 'ok' &&
    health?.supabase?.filesTable === 'ok' &&
    (health?.supabase?.readingProgressTable ?? 'ok') === 'ok' &&
    health?.supabase?.bucketFound;

  return (
    <div className="min-h-screen bg-background text-on-background pb-28">
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur px-6 py-4 border-b border-outline-variant/20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-headline">Digital Bookshelf</h1>
          <div className={`text-xs px-3 py-1 rounded-full ${supabaseOk ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
            {supabaseOk ? 'Supabase Connected' : 'Supabase Not Ready'}
          </div>
        </div>
        {backendError && <p className="mt-2 text-sm text-error">{backendError}</p>}
      </header>

      <main className="max-w-5xl mx-auto px-6 pt-6 space-y-6">
        {tab === 'bookshelf' && (
          <>
            <div className="flex flex-wrap gap-3 items-center">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title or author"
                className="h-10 px-4 rounded-full bg-surface-container-high outline-none"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-10 px-3 rounded-full bg-surface-container-high outline-none"
              >
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <label className="h-10 px-4 rounded-full bg-primary text-on-primary cursor-pointer flex items-center text-sm">
                Upload TXT/EPUB
                <input type="file" accept=".txt,.epub" className="hidden" onChange={handleUploadInput} />
              </label>
              <button onClick={loadData} className="h-10 px-4 rounded-full bg-surface-container-high text-sm">
                Refresh
              </button>
            </div>

            {(uploading || uploadMessage) && (
              <div className="bg-surface-container-low rounded-xl p-4">
                <div className="flex justify-between text-sm mb-2">
                  <span>{uploadMessage || 'Uploading...'}</span>
                  <span>{uploading ? `${uploadProgress}%` : ''}</span>
                </div>
                <div className="w-full h-2 rounded bg-surface-container-high overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{width: `${uploadProgress}%`}} />
                </div>
              </div>
            )}

            <BookGrid books={visibleBooks} onBookClick={openDetails} onArchive={archiveBook} onDelete={deleteBook} />
            <h3 className="text-lg font-semibold">Archived ({archivedBooks.length})</h3>
            <BookGrid books={archivedBooks} onBookClick={openDetails} onArchive={archiveBook} onDelete={deleteBook} />
          </>
        )}

        {tab === 'library' && (
          <div className="space-y-4">
            {library.map((book) => (
              <div key={book.id} className="p-4 rounded-xl bg-surface-container-low flex items-center gap-4">
                <img src={book.cover} alt={book.title} className="w-16 h-24 object-cover rounded" />
                <div className="flex-1">
                  <h4 className="font-semibold">{book.title}</h4>
                  <p className="text-sm text-on-surface-variant">{book.author}</p>
                </div>
                <button onClick={() => openDetails(book)} className="px-3 py-2 rounded bg-surface-container-high">
                  Details
                </button>
                <button
                  onClick={() => downloadBook(book)}
                  disabled={bookshelf.some((b) => b.id === book.id)}
                  className="px-3 py-2 rounded bg-primary text-on-primary disabled:opacity-40"
                >
                  {bookshelf.some((b) => b.id === book.id) ? 'Downloaded' : 'Download'}
                </button>
                <button
                  onClick={() => deleteFromLibrary(book.id)}
                  className="px-3 py-2 rounded bg-error text-on-error"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === 'profile' && <div className="p-6 rounded-xl bg-surface-container-low">Profile tab placeholder.</div>}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-background/90 backdrop-blur border-t border-outline-variant/20 grid grid-cols-3">
        <button className="py-4" onClick={() => setTab('bookshelf')}>
          Bookshelf
        </button>
        <button className="py-4" onClick={() => setTab('library')}>
          Library
        </button>
        <button className="py-4" onClick={() => setTab('profile')}>
          Profile
        </button>
      </nav>
    </div>
  );
}

function BookGrid({
  books,
  onBookClick,
  onArchive,
  onDelete,
}: {
  books: AppBook[];
  onBookClick: (book: AppBook) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (books.length === 0) return <div className="text-sm text-on-surface-variant">No books.</div>;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {books.map((book) => (
        <article key={book.id} className="bg-surface-container-low rounded-xl p-3 space-y-2">
          <img
            src={book.cover}
            alt={book.title}
            className="w-full aspect-[2/3] rounded object-cover cursor-pointer"
            onClick={() => onBookClick(book)}
          />
          <h4 className="font-semibold line-clamp-1">{book.title}</h4>
          <p className="text-sm text-on-surface-variant line-clamp-1">{book.author}</p>
          <div className="text-xs text-on-surface-variant">{book.fileType ? `File: ${book.fileType.toUpperCase()}` : ''}</div>
          <div className="flex gap-2">
            <button onClick={() => onArchive(book.id)} className="text-xs px-2 py-1 rounded bg-surface-container-high">
              {book.isArchived ? 'Unarchive' : 'Archive'}
            </button>
            <button onClick={() => onDelete(book.id)} className="text-xs px-2 py-1 rounded bg-error text-on-error">
              Delete
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function BookDetails({
  book,
  onBack,
  onRead,
  onDownload,
  isDownloaded,
}: {
  book: AppBook;
  onBack: () => void;
  onRead: () => void;
  onDownload: () => void;
  isDownloaded: boolean;
}) {
  return (
    <div className="min-h-screen bg-background px-6 py-8 max-w-4xl mx-auto">
      <button onClick={onBack} className="mb-6 text-primary">
        Back
      </button>
      <div className="grid md:grid-cols-[260px_1fr] gap-8">
        <img src={book.cover} alt={book.title} className="w-full max-w-[260px] aspect-[2/3] rounded-xl object-cover" />
        <div className="space-y-3">
          <h2 className="text-4xl font-headline">{book.title}</h2>
          <p>{book.author}</p>
          <p className="text-sm text-on-surface-variant">{book.description?.join(' ') || 'No description available.'}</p>
          {book.fileType === 'txt' && <p className="text-xs text-on-surface-variant">Encoding: {book.textEncoding || 'unknown'}</p>}
          <div className="flex gap-3 pt-3">
            <button onClick={onRead} className="px-4 py-2 rounded bg-primary text-on-primary">
              Read
            </button>
            <button
              onClick={onDownload}
              disabled={isDownloaded}
              className="px-4 py-2 rounded bg-surface-container-high disabled:opacity-40"
            >
              {isDownloaded ? 'Downloaded' : 'Download'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadingView({book, onBack}: {book: AppBook; onBack: () => void}) {
  const [chapters, setChapters] = useState<Array<{id: string; title: string; text: string; level?: number}>>([]);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [chapterError, setChapterError] = useState('');
  const [tocOpen, setTocOpen] = useState(false);
  const [scrollPercent, setScrollPercent] = useState(0);
  const contentRef = useRef<HTMLElement | null>(null);
  const pendingRestorePercentRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(false);

  useEffect(() => {
    const localParagraphs =
      book.fileType === 'txt' && book.textContent
        ? book.textContent
            .split(/\r?\n\s*\r?\n/)
            .map((p) => p.trim())
            .filter(Boolean)
        : book.description || ['Reading content placeholder...'];

    setChapters([{id: 'chapter-1', title: 'Chapter 1', text: localParagraphs.join('\n\n'), level: 1}]);
    setChapterIndex(0);
    setChapterError('');
    setScrollPercent(0);
    pendingRestorePercentRef.current = 0;

    if (!book.fileType) {
      return;
    }

    const loadChapters = async () => {
      setLoading(true);
      try {
        const response = await requestJson<ChaptersResponse>(`/books/${book.id}/chapters`);
        if (response.data.chapters.length > 0) {
          setChapters(response.data.chapters);
          const progressRes = await requestJson<ReadingProgressResponse>(`/books/${book.id}/reading-progress`);
          const savedChapter = Math.max(0, progressRes.data.chapterIndex || 0);
          const savedScroll = Math.min(100, Math.max(0, progressRes.data.scrollPercent || 0));
          pendingRestorePercentRef.current = savedScroll;
          setChapterIndex(Math.min(savedChapter, response.data.chapters.length - 1));
          setScrollPercent(savedScroll);
        }
      } catch (error) {
        setChapterError(error instanceof Error ? error.message : 'Failed to parse chapters');
      } finally {
        setLoading(false);
      }
    };

    loadChapters();
  }, [book]);

  useEffect(() => {
    const handleScroll = () => {
      const el = contentRef.current;
      if (!el) return;
      const top = el.offsetTop;
      const total = Math.max(1, el.scrollHeight - window.innerHeight + 120);
      const current = Math.min(Math.max(0, window.scrollY - top), total);
      const pct = Math.min(100, Math.max(0, (current / total) * 100));
      setScrollPercent(pct);
    };

    window.addEventListener('scroll', handleScroll, {passive: true});
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    if (pendingRestorePercentRef.current !== null) {
      const pct = pendingRestorePercentRef.current;
      pendingRestorePercentRef.current = null;
      requestAnimationFrame(() => {
        const top = el.offsetTop;
        const total = Math.max(1, el.scrollHeight - window.innerHeight + 120);
        const target = top + (pct / 100) * total;
        window.scrollTo({top: Math.max(0, target), behavior: 'auto'});
      });
      return;
    }

    if (pendingScrollTopRef.current) {
      pendingScrollTopRef.current = false;
      requestAnimationFrame(() => {
        window.scrollTo({top: Math.max(0, el.offsetTop - 12), behavior: 'auto'});
      });
    }
  }, [chapterIndex, chapters.length]);

  useEffect(() => {
    if (chapters.length === 0) return;
    const timer = setTimeout(() => {
      requestJson(`/books/${book.id}/reading-progress`, {
        method: 'PUT',
        body: JSON.stringify({
          chapterIndex,
          totalChapters: chapters.length,
          scrollPercent,
        }),
      }).catch(() => undefined);
    }, 600);

    return () => clearTimeout(timer);
  }, [book.id, chapterIndex, chapters.length, scrollPercent]);

  const jumpToChapter = (idx: number) => {
    pendingRestorePercentRef.current = null;
    pendingScrollTopRef.current = true;
    setScrollPercent(0);
    setChapterIndex(Math.max(0, Math.min(idx, chapters.length - 1)));
  };

  const currentChapter = chapters[Math.min(chapterIndex, Math.max(0, chapters.length - 1))];
  const currentParagraphs = (currentChapter?.text || '')
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur border-b border-outline-variant/20 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <button onClick={onBack} className="text-primary text-sm font-medium">
            Back
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold truncate">{book.title}</h1>
            <p className="text-xs text-on-surface-variant truncate">{currentChapter?.title || 'Chapter'}</p>
          </div>
          <button
            onClick={() => setTocOpen(true)}
            className="px-3 py-1.5 text-xs rounded-full bg-surface-container-high"
          >
            TOC
          </button>
        </div>
      </header>

      {tocOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setTocOpen(false)} />
          <aside className="absolute right-0 top-0 h-full w-[86vw] max-w-sm bg-background border-l border-outline-variant/20 p-4 overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">目录</h2>
              <button onClick={() => setTocOpen(false)} className="text-sm text-on-surface-variant">
                Close
              </button>
            </div>
            {loading && <p className="text-sm text-on-surface-variant mb-3">Parsing chapters...</p>}
            {chapterError && <p className="text-sm text-error mb-3">{chapterError}</p>}
            <div className="space-y-2">
              {chapters.map((chapter, idx) => (
                <button
                  key={chapter.id}
                  onClick={() => {
                    jumpToChapter(idx);
                    setTocOpen(false);
                  }}
                  style={{paddingLeft: `${12 + Math.min(4, Math.max(0, (chapter.level || 1) - 1)) * 10}px`}}
                  className={`w-full text-left py-2 rounded text-sm ${
                    idx === chapterIndex ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface'
                  }`}
                >
                  {chapter.title}
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}

      <main className="max-w-3xl mx-auto px-5 sm:px-8 py-7">
        <article ref={contentRef} className="bg-surface-container-low rounded-2xl px-5 sm:px-8 py-7">
          <h2 className="text-2xl sm:text-3xl font-headline mb-1">{book.title}</h2>
          <p className="text-sm text-on-surface-variant mb-7">{book.author}</p>
          <h3 className="text-base font-semibold mb-5">{currentChapter?.title || 'Chapter'}</h3>

          <div className="text-[17px] sm:text-[18px] leading-[2.1] tracking-[0.012em] text-on-surface/90">
            {currentParagraphs.map((p, idx) => (
              <p key={idx} className="mb-6 indent-8 whitespace-pre-wrap break-words">
                {p}
              </p>
            ))}
          </div>

          {currentParagraphs.length === 0 && <p className="text-on-surface-variant">No readable content.</p>}
        </article>
      </main>

      <div className="fixed bottom-0 left-0 right-0 border-t border-outline-variant/20 bg-background/95 backdrop-blur px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            onClick={() => jumpToChapter(chapterIndex - 1)}
            disabled={chapterIndex <= 0}
            className="flex-1 rounded-lg py-2 text-sm bg-surface-container-high disabled:opacity-40"
          >
            上一章
          </button>
          <div className="text-xs text-on-surface-variant px-2">
            {chapters.length > 0 ? `${chapterIndex + 1}/${chapters.length}` : '--/--'}
          </div>
          <button
            onClick={() => jumpToChapter(chapterIndex + 1)}
            disabled={chapterIndex >= chapters.length - 1}
            className="flex-1 rounded-lg py-2 text-sm bg-primary text-on-primary disabled:opacity-40"
          >
            下一章
          </button>
        </div>
      </div>
    </div>
  );
}

