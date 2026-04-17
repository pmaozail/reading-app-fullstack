export type BookStatus = 'unread' | 'reading' | 'completed';

export interface BookRecord {
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
}

export interface LibraryBook {
  id: string;
  title: string;
  author: string;
  cover: string;
  category: string;
  size: string;
  rating: number;
  reviews: number;
  description?: string[];
  publisher?: string;
  pages?: number;
  publishDate?: string;
  authorEn?: string;
}

export const INITIAL_BOOKSHELF: BookRecord[] = [
  {
    id: '1',
    title: 'Meditations',
    author: 'Marcus Aurelius',
    cover: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?q=80&w=600&auto=format&fit=crop',
    progress: 12,
    status: 'reading',
    category: 'Philosophy',
    isArchived: false,
  },
  {
    id: '2',
    title: 'Narrative Economics',
    author: 'Robert Shiller',
    cover: 'https://images.unsplash.com/photo-1531901599143-df5010ab9438?q=80&w=600&auto=format&fit=crop',
    progress: 100,
    status: 'completed',
    category: 'Economics',
    isArchived: false,
  },
  {
    id: '3',
    title: 'To Kill a Mockingbird',
    author: 'Harper Lee',
    cover: 'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?q=80&w=600&auto=format&fit=crop',
    progress: 45,
    status: 'reading',
    category: 'Novel',
    isArchived: false,
  },
];

export const INITIAL_LIBRARY: LibraryBook[] = [
  {
    id: 'l1',
    title: 'The Stranger',
    author: 'Albert Camus',
    cover: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?q=80&w=600&auto=format&fit=crop',
    size: '1.8 MB',
    rating: 4.7,
    reviews: 342,
    category: 'Novel',
    description: ['A classic novel on absurdity and freedom.'],
    publisher: 'Gallimard',
    pages: 192,
    publishDate: '1942-01',
  },
  {
    id: 'l2',
    title: 'Sapiens',
    author: 'Yuval Noah Harari',
    cover: 'https://images.unsplash.com/photo-1519682337058-a94d519337bc?q=80&w=600&auto=format&fit=crop',
    size: '3.1 MB',
    rating: 4.8,
    reviews: 1180,
    category: 'History',
    description: ['A brief history of humankind.'],
    publisher: 'Harvill Secker',
    pages: 446,
    publishDate: '2011-01',
  },
  {
    id: 'l3',
    title: 'The Great Gatsby',
    author: 'F. Scott Fitzgerald',
    authorEn: 'F. Scott Fitzgerald',
    cover: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?q=80&w=600&auto=format&fit=crop',
    size: '1.4 MB',
    rating: 4.8,
    reviews: 1240,
    category: 'Classic',
    description: ['A story about desire, class, and the collapse of a dream.'],
    publisher: 'Scribner',
    pages: 218,
    publishDate: '1925-04',
  },
];
