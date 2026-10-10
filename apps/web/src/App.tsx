import { useEffect, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { PanelSlot } from './features/PanelSlot';
import { getHealth, type Health } from './lib/api';
import { Courses } from './routes/Courses';
import { CourseLayout } from './routes/CourseLayout';
import { Upload } from './routes/Upload';
import { Viewer } from './routes/Viewer';
import { AlignmentMap } from './routes/AlignmentMap';
import { CoverageScreen } from './routes/Coverage';
import { Chat } from './routes/Chat';

function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Gyan Setu</h1>
      <p className="text-slate-600">Bridge your professor's slides and your textbook.</p>
      {error && <p className="text-red-600">Server unreachable: {error}</p>}
      {!health && !error && <p className="text-slate-500">Connecting to server…</p>}
      {health && (
        <p className="text-green-700">
          Server OK — LLM: {health.llmProvider}, embeddings: {health.embeddingsProvider}
        </p>
      )}
      <Link to="/courses" className="inline-block font-medium text-blue-700">
        Go to Courses →
      </Link>
      <PanelSlot slot="global" />
    </div>
  );
}

export function App() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <nav className="mb-6 flex gap-4 border-b border-slate-200 pb-3">
        <Link to="/" className="font-medium text-blue-700">
          Home
        </Link>
        <Link to="/courses" className="font-medium text-blue-700">
          Courses
        </Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/courses" element={<Courses />} />
        <Route path="/courses/:courseId" element={<CourseLayout />}>
          <Route index element={<Upload />} />
          <Route path="documents" element={<Upload />} />
          <Route path="viewer" element={<Viewer />} />
          <Route path="align" element={<AlignmentMap />} />
          <Route path="coverage" element={<CoverageScreen />} />
          <Route path="chat" element={<Chat />} />
        </Route>
      </Routes>
    </div>
  );
}
