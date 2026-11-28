-- Cover all archive foreign keys with indexes to keep lookup and retention operations efficient.
create index if not exists afe_coo_mission_archives_mission_id_idx
  on public.afe_coo_mission_archives (mission_id);
create index if not exists afe_coo_mission_archive_documents_archive_workspace_idx
  on public.afe_coo_mission_archive_documents (archive_id, workspace_id);
create index if not exists afe_coo_mission_archive_documents_source_document_idx
  on public.afe_coo_mission_archive_documents (source_document_id);
create index if not exists afe_coo_mission_archive_documents_uploaded_by_idx
  on public.afe_coo_mission_archive_documents (uploaded_by);
create index if not exists afe_coo_mission_archive_documents_linked_by_idx
  on public.afe_coo_mission_archive_documents (linked_by);
