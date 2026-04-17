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
    category: '小说',
    isArchived: false,
    rating: 4.7,
    reviews: 342,
    size: '1.8 MB',
    description: ['一部关于荒诞与自由的经典小说。'],
  },
  {
    id: 'l2',
    title: 'Sapiens',
    author: 'Yuval Noah Harari',
    cover: 'https://images.unsplash.com/photo-1519682337058-a94d519337bc?q=80&w=600&auto=format&fit=crop',
    progress: 0,
    status: 'unread',
    category: '历史',
    isArchived: false,
    rating: 4.8,
    reviews: 1180,
    size: '3.1 MB',
    description: ['一部简明的人类文明史。'],
  },
];

const requestJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {'Content-Type': 'application/json'},
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`请求失败（${response.status}）：${text}`);
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
      reject(new Error(xhr.responseText || `上传失败（${xhr.status}）`));
    };

    xhr.onerror = () => reject(new Error('上传文件时网络异常'));

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
  const [category, setCategory] = useState('全部');
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
      setBackendError(error instanceof Error ? error.message : '连接后端失败');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const visibleBooks = useMemo(() => {
    return bookshelf.filter((b) => {
      const inCategory = category === '全部' || b.category === category;
      const hit =
        b.title.toLowerCase().includes(query.toLowerCase()) ||
        b.author.toLowerCase().includes(query.toLowerCase());
      return !b.isArchived && inCategory && hit;
    });
  }, [bookshelf, category, query]);

  const archivedBooks = bookshelf.filter((b) => b.isArchived);
  const categories = ['全部', ...Array.from(new Set(bookshelf.map((b) => b.category || '未分类')))];

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
      setUploadMessage(error instanceof Error ? error.message : '删除失败');
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
      setUploadMessage('下载后保存失败，请检查 Supabase 连接。');
    }
  };

  const handleUploadInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const isSupported = file.name.toLowerCase().endsWith('.txt') || file.name.toLowerCase().endsWith('.epub');
    if (!isSupported) {
      setUploadMessage('仅支持 .txt 和 .epub 文件。');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadMessage('上传中...');

    try {
      const uploadedBook = await uploadFileWithProgress(file, setUploadProgress);
      setBookshelf((prev) => [uploadedBook, ...prev]);
      setLibrary((prev) => (prev.some((b) => b.id === uploadedBook.id) ? prev : [uploadedBook, ...prev]));
      setUploadMessage(
        uploadedBook.fileType === 'txt'
          ? `TXT 上传成功（编码：${uploadedBook.textEncoding || '未知'}）`
          : 'EPUB 上传成功'
      );
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : '上传失败');
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
          <h1 className="text-2xl font-headline">数字书库</h1>
          <div className={`text-xs px-3 py-1 rounded-full ${supabaseOk ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
            {supabaseOk ? 'Supabase 已连接' : 'Supabase 未就绪'}
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
                placeholder="搜索书名或作者"
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
                上传 TXT/EPUB
                <input type="file" accept=".txt,.epub" className="hidden" onChange={handleUploadInput} />
              </label>
              <button onClick={loadData} className="h-10 px-4 rounded-full bg-surface-container-high text-sm">
                刷新
              </button>
            </div>

            {(uploading || uploadMessage) && (
              <div className="bg-surface-container-low rounded-xl p-4">
                <div className="flex justify-between text-sm mb-2">
                  <span>{uploadMessage || '上传中...'}</span>
                  <span>{uploading ? `${uploadProgress}%` : ''}</span>
                </div>
                <div className="w-full h-2 rounded bg-surface-container-high overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{width: `${uploadProgress}%`}} />
                </div>
              </div>
            )}

            <BookGrid books={visibleBooks} onBookClick={openDetails} onArchive={archiveBook} onDelete={deleteBook} />
            <h3 className="text-lg font-semibold">已归档（{archivedBooks.length}）</h3>
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
                  详情
                </button>
                <button
                  onClick={() => downloadBook(book)}
                  disabled={bookshelf.some((b) => b.id === book.id)}
                  className="px-3 py-2 rounded bg-primary text-on-primary disabled:opacity-40"
                >
                  {bookshelf.some((b) => b.id === book.id) ? '已下载' : '下载'}
                </button>
                <button
                  onClick={() => deleteFromLibrary(book.id)}
                  className="px-3 py-2 rounded bg-error text-on-error"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === 'profile' && (
          <ProfileView
            bookshelf={bookshelf}
            library={library}
            health={health}
            onRefresh={loadData}
          />
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-background/90 backdrop-blur border-t border-outline-variant/20 grid grid-cols-3">
        <button className="py-4" onClick={() => setTab('bookshelf')}>
          书架
        </button>
        <button className="py-4" onClick={() => setTab('library')}>
          书库
        </button>
        <button className="py-4" onClick={() => setTab('profile')}>
          我的
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
  if (books.length === 0) return <div className="text-sm text-on-surface-variant">暂无书籍。</div>;

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
          <div className="text-xs text-on-surface-variant">{book.fileType ? `文件：${book.fileType.toUpperCase()}` : ''}</div>
          <div className="flex gap-2">
            <button onClick={() => onArchive(book.id)} className="text-xs px-2 py-1 rounded bg-surface-container-high">
              {book.isArchived ? '取消归档' : '归档'}
            </button>
            <button onClick={() => onDelete(book.id)} className="text-xs px-2 py-1 rounded bg-error text-on-error">
              删除
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
        返回
      </button>
      <div className="grid md:grid-cols-[260px_1fr] gap-8">
        <img src={book.cover} alt={book.title} className="w-full max-w-[260px] aspect-[2/3] rounded-xl object-cover" />
        <div className="space-y-3">
          <h2 className="text-4xl font-headline">{book.title}</h2>
          <p>{book.author}</p>
          <p className="text-sm text-on-surface-variant">{book.description?.join(' ') || '暂无简介。'}</p>
          {book.fileType === 'txt' && <p className="text-xs text-on-surface-variant">编码：{book.textEncoding || '未知'}</p>}
          <div className="flex gap-3 pt-3">
            <button onClick={onRead} className="px-4 py-2 rounded bg-primary text-on-primary">
              阅读
            </button>
            <button
              onClick={onDownload}
              disabled={isDownloaded}
              className="px-4 py-2 rounded bg-surface-container-high disabled:opacity-40"
            >
              {isDownloaded ? '已下载' : '下载'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileView({
  bookshelf,
  library,
  health,
  onRefresh,
}: {
  bookshelf: AppBook[];
  library: AppBook[];
  health: HealthResponse | null;
  onRefresh: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('profile.displayName') || '读者');
  const [email, setEmail] = useState(() => localStorage.getItem('profile.email') || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    localStorage.setItem('profile.displayName', displayName);
  }, [displayName]);

  useEffect(() => {
    localStorage.setItem('profile.email', email);
  }, [email]);

  const completedCount = bookshelf.filter((b) => b.status === 'completed').length;
  const readingCount = bookshelf.filter((b) => b.progress > 0 && b.progress < 100).length;
  const uploadedCount = bookshelf.filter((b) => b.fileType === 'txt' || b.fileType === 'epub').length;

  const runRefresh = async () => {
    setSaving(true);
    try {
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 pb-6">
      <section className="p-5 rounded-2xl bg-surface-container-low">
        <h2 className="text-xl font-semibold mb-4">个人信息</h2>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-on-surface-variant">昵称</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full h-10 px-3 rounded-lg bg-surface-container-high outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs text-on-surface-variant">邮箱</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="请输入邮箱"
              className="mt-1 w-full h-10 px-3 rounded-lg bg-surface-container-high outline-none"
            />
          </label>
        </div>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="书库总量" value={library.length} />
        <StatCard title="书架数量" value={bookshelf.length} />
        <StatCard title="阅读中" value={readingCount} />
        <StatCard title="已读完" value={completedCount} />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <StatCard title="已上传文件" value={uploadedCount} />
        <div className="rounded-xl p-4 bg-surface-container-low">
          <p className="text-xs text-on-surface-variant mb-1">数据库状态</p>
          <p className="text-sm">
            数据库: {health?.supabase?.database || '未知'} | 存储: {health?.supabase?.storage || '未知'}
          </p>
          <p className="text-sm">
            文件表: {health?.supabase?.filesTable || '未知'} | 进度表: {health?.supabase?.readingProgressTable || '未知'}
          </p>
        </div>
      </section>

      <section className="p-5 rounded-2xl bg-surface-container-low">
        <h3 className="text-lg font-semibold mb-3">操作</h3>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={runRefresh}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-primary text-on-primary disabled:opacity-40"
          >
            {saving ? '同步中...' : '刷新并同步'}
          </button>
          <button
            onClick={() => {
              localStorage.removeItem('profile.displayName');
              localStorage.removeItem('profile.email');
              setDisplayName('读者');
              setEmail('');
            }}
            className="px-4 py-2 rounded-lg bg-surface-container-high"
          >
            重置资料
          </button>
        </div>
      </section>
    </div>
  );
}

function StatCard({title, value}: {title: string; value: number}) {
  return (
    <div className="rounded-xl p-4 bg-surface-container-low">
      <p className="text-xs text-on-surface-variant">{title}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
    </div>
  );
}

function ReadingView({book, onBack}: {book: AppBook; onBack: () => void}) {
  const [chapters, setChapters] = useState<Array<{id: string; title: string; text: string; level?: number}>>([]);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [chapterError, setChapterError] = useState('');
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scrollPercent, setScrollPercent] = useState(0);
  const [progressReady, setProgressReady] = useState(false);
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('reader.fontSize') || 18));
  const [lineHeight, setLineHeight] = useState(() => Number(localStorage.getItem('reader.lineHeight') || 2.1));
  const [fontFamily, setFontFamily] = useState<'serif' | 'sans' | 'mono'>(
    () => (localStorage.getItem('reader.fontFamily') as 'serif' | 'sans' | 'mono') || 'serif'
  );
  const [themeMode, setThemeMode] = useState<'day' | 'night'>(
    () => (localStorage.getItem('reader.theme') as 'day' | 'night') || 'day'
  );
  const contentRef = useRef<HTMLElement | null>(null);
  const pendingRestorePercentRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(false);

  useEffect(() => localStorage.setItem('reader.fontSize', String(fontSize)), [fontSize]);
  useEffect(() => localStorage.setItem('reader.lineHeight', String(lineHeight)), [lineHeight]);
  useEffect(() => localStorage.setItem('reader.fontFamily', fontFamily), [fontFamily]);
  useEffect(() => localStorage.setItem('reader.theme', themeMode), [themeMode]);

  useEffect(() => {
    const localParagraphs =
      book.fileType === 'txt' && book.textContent
        ? book.textContent
            .split(/\r?\n\s*\r?\n/)
            .map((p) => p.trim())
            .filter(Boolean)
        : book.description || ['暂无可读内容。'];

    setChapters([{id: 'chapter-1', title: '第 1 章', text: localParagraphs.join('\n\n'), level: 1}]);
    setChapterIndex(0);
    setChapterError('');
    setScrollPercent(0);
    setProgressReady(false);
    pendingRestorePercentRef.current = 0;

    if (!book.fileType) {
      setTimeout(() => setProgressReady(true), 0);
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
        setChapterError(error instanceof Error ? error.message : '章节解析失败');
        setProgressReady(true);
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
        setProgressReady(true);
      });
      return;
    }

    if (pendingScrollTopRef.current) {
      pendingScrollTopRef.current = false;
      requestAnimationFrame(() => {
        window.scrollTo({top: Math.max(0, el.offsetTop - 12), behavior: 'auto'});
        setProgressReady(true);
      });
      return;
    }

    if (!progressReady) {
      setProgressReady(true);
    }
  }, [chapterIndex, chapters.length, progressReady]);

  useEffect(() => {
    if (chapters.length === 0 || !progressReady) return;
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
  }, [book.id, chapterIndex, chapters.length, scrollPercent, progressReady]);

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
  const pageNight = themeMode === 'night';
  const pageClass = pageNight ? 'bg-slate-900 text-slate-100' : 'bg-background text-on-background';
  const surfaceClass = pageNight ? 'bg-slate-800/90 text-slate-100' : 'bg-surface-container-low text-on-surface';
  const headerClass = pageNight
    ? 'bg-slate-900/90 border-slate-700'
    : 'bg-background/90 border-outline-variant/20';
  const buttonMutedClass = pageNight ? 'bg-slate-700 text-slate-100' : 'bg-surface-container-high text-on-surface';
  const readerFontClass =
    fontFamily === 'serif' ? 'font-reading' : fontFamily === 'sans' ? 'font-body' : 'font-mono';

  return (
    <div className={`min-h-screen pb-24 ${pageClass}`}>
      <header className={`sticky top-0 z-40 backdrop-blur border-b px-4 py-3 ${headerClass}`}>
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <button onClick={onBack} className="text-primary text-sm font-medium">
            返回
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold truncate">{book.title}</h1>
            <p className="text-xs text-on-surface-variant truncate">{currentChapter?.title || '章节'}</p>
          </div>
          <button onClick={() => setSettingsOpen(true)} className={`px-3 py-1.5 text-xs rounded-full ${buttonMutedClass}`}>
            Aa
          </button>
          <button onClick={() => setTocOpen(true)} className={`px-3 py-1.5 text-xs rounded-full ${buttonMutedClass}`}>
            目录
          </button>
        </div>
      </header>

      {settingsOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSettingsOpen(false)} />
          <aside className={`absolute right-0 top-0 h-full w-[86vw] max-w-sm border-l p-4 overflow-auto ${surfaceClass}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">阅读设置</h2>
              <button onClick={() => setSettingsOpen(false)} className="text-sm opacity-80">
                关闭
              </button>
            </div>

            <div className="space-y-5">
              <div>
                <p className="text-sm mb-2">字体</p>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => setFontFamily('serif')} className={`rounded px-2 py-2 text-sm ${fontFamily === 'serif' ? 'bg-primary text-on-primary' : buttonMutedClass}`}>衬线</button>
                  <button onClick={() => setFontFamily('sans')} className={`rounded px-2 py-2 text-sm ${fontFamily === 'sans' ? 'bg-primary text-on-primary' : buttonMutedClass}`}>无衬线</button>
                  <button onClick={() => setFontFamily('mono')} className={`rounded px-2 py-2 text-sm ${fontFamily === 'mono' ? 'bg-primary text-on-primary' : buttonMutedClass}`}>等宽</button>
                </div>
              </div>

              <div>
                <p className="text-sm mb-2">字号 {fontSize}px</p>
                <input type="range" min={14} max={30} step={1} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="w-full" />
              </div>

              <div>
                <p className="text-sm mb-2">行距 {lineHeight.toFixed(1)}</p>
                <input type="range" min={1.5} max={2.6} step={0.1} value={lineHeight} onChange={(e) => setLineHeight(Number(e.target.value))} className="w-full" />
              </div>

              <div>
                <p className="text-sm mb-2">主题</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setThemeMode('day')} className={`rounded px-3 py-2 text-sm ${themeMode === 'day' ? 'bg-primary text-on-primary' : buttonMutedClass}`}>日间</button>
                  <button onClick={() => setThemeMode('night')} className={`rounded px-3 py-2 text-sm ${themeMode === 'night' ? 'bg-primary text-on-primary' : buttonMutedClass}`}>夜间</button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {tocOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setTocOpen(false)} />
          <aside className={`absolute right-0 top-0 h-full w-[86vw] max-w-sm border-l p-4 overflow-auto ${surfaceClass}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">目录</h2>
              <button onClick={() => setTocOpen(false)} className="text-sm text-on-surface-variant">
                关闭
              </button>
            </div>
            {loading && <p className="text-sm text-on-surface-variant mb-3">正在解析章节...</p>}
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
                    idx === chapterIndex ? 'bg-primary text-on-primary' : buttonMutedClass
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
        <article ref={contentRef} className={`rounded-2xl px-5 sm:px-8 py-7 ${surfaceClass}`}>
          <h2 className="text-2xl sm:text-3xl font-headline mb-1">{book.title}</h2>
          <p className="text-sm text-on-surface-variant mb-7">{book.author}</p>
          <h3 className="text-base font-semibold mb-5">{currentChapter?.title || '章节'}</h3>

          <div
            className={`tracking-[0.012em] ${readerFontClass}`}
            style={{fontSize: `${fontSize}px`, lineHeight}}
          >
            {currentParagraphs.map((p, idx) => (
              <p key={idx} className="mb-6 indent-8 whitespace-pre-wrap break-words">
                {p}
              </p>
            ))}
          </div>

          {currentParagraphs.length === 0 && <p className="text-on-surface-variant">暂无可阅读内容。</p>}
        </article>
      </main>

      <div className={`fixed bottom-0 left-0 right-0 border-t backdrop-blur px-4 py-3 ${headerClass}`}>
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            onClick={() => jumpToChapter(chapterIndex - 1)}
            disabled={chapterIndex <= 0}
            className={`flex-1 rounded-lg py-2 text-sm disabled:opacity-40 ${buttonMutedClass}`}
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

