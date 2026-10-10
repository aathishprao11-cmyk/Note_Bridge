import { NavLink, Outlet, useParams } from 'react-router-dom';
import { listCourses } from '../lib/api';
import { useEffect, useState } from 'react';
import type { Course } from '../lib/types';
import { Loading } from '../components/ui';

const TABS = [
  { to: 'documents', label: 'Documents' },
  { to: 'viewer', label: 'Viewer' },
  { to: 'align', label: 'Alignment map' },
  { to: 'coverage', label: 'Coverage' },
  { to: 'chat', label: 'Chat' },
] as const;

/** Layout for a single course: header + per-course sub-nav, renders the active screen. */
export function CourseLayout() {
  const { courseId = '' } = useParams();
  const [course, setCourse] = useState<Course | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCourses()
      .then((all) => {
        if (!cancelled) setCourse(all.find((c) => c.id === courseId) ?? null);
      })
      .catch(() => {
        if (!cancelled) setCourse(null);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  return (
    <div className="space-y-6">
      <header>
        <NavLink to="/courses" className="text-sm text-blue-700">
          ← All courses
        </NavLink>
        <h1 className="mt-1 text-2xl font-bold">{course?.name ?? <Loading />}</h1>
      </header>

      <nav className="flex gap-4 border-b border-slate-200 pb-2">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={`/courses/${encodeURIComponent(courseId)}/${tab.to}`}
            className={({ isActive }) =>
              `text-sm font-medium ${isActive ? 'text-blue-700 underline' : 'text-slate-600 hover:text-blue-700'}`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
