import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  apiFetch,
  apiFetchForm,
  getErrorMessage,
} from "@/lib/api";
import { ErrorBanner } from "@/components/ui/EmptyState";
import { profilePhotoKey, useProfilePhoto } from '@/lib/profilePhoto';
import { ProfileAvatar } from './ProfileAvatar';

type Photo = { url: string | null };

export function ProfilePhotoEditor({
  userId,
  name,
  initials,
  onChanged,
}: {
  userId?: string;
  name: string;
  initials: string;
  onChanged: (message: string) => void;
}) {
  const client = useQueryClient();
  const queryKey = profilePhotoKey(userId);
  const { data, isPending, isError, refetch } = useProfilePhoto(userId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const photoUrl = data?.url;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const root = document.getElementById("root");
    const previousInert = root?.inert;
    if (root) root.inert = true;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) setOpen(false);
      if (event.key !== "Tab") return;
      const buttons = Array.from(
        dialog.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) || [],
      );
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (root) root.inert = previousInert ?? false;
      document.removeEventListener("keydown", keydown);
      trigger.current?.focus();
    };
  }, [open]);

  async function change(file?: File) {
    if (busyRef.current) return;
    setError(null);
    if (
      file &&
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      setError("Choose a PNG, JPG or WebP image.");
      return;
    }
    if (file && file.size > 5 * 1024 * 1024) {
      setError("Use a photo smaller than 5 MB.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      let result: Photo;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        result = await apiFetchForm<Photo>("/users/me/photo", form);
      } else {
        result = await apiFetch<Photo>("/users/me/photo", { method: "DELETE" });
      }
      client.setQueryData(queryKey, result);
      onChanged(file ? "Profile photo updated." : "Profile photo removed.");
      setOpen(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const avatar = (large = false) => (
    <ProfileAvatar userId={userId} name={name} initials={initials} className={"account-avatar" + (large ? " photo-dialog-avatar" : "")} />
  );
  return (
    <>
      <div className="profile-photo-area">
        {avatar()}
        <button
          ref={trigger}
          type="button"
          className="profile-photo-edit"
          aria-label="Edit profile photo"
          aria-haspopup="dialog"
          disabled={!userId}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          <i className="ti ti-pencil" aria-hidden /> <span>Edit</span>
        </button>
      </div>
      {open &&
        createPortal(
          <div
            className="profile-photo-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget && !busy) setOpen(false);
            }}
          >
            <div
              ref={dialog}
              className="profile-photo-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="photo-dialog-title"
              aria-describedby="photo-dialog-description"
              tabIndex={-1}
              aria-busy={busy}
            >
              <div className="photo-dialog-heading">
                <h2 id="photo-dialog-title">Profile photo</h2>
                <button
                  className="btn btn-ghost"
                  type="button"
                  aria-label="Close photo editor"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  <i className="ti ti-x" aria-hidden />
                </button>
              </div>
              {avatar(true)}
              <p id="photo-dialog-description" className="muted">
                Choose a photo to personalize your profile.
              </p>
              {error && <ErrorBanner>{error}</ErrorBanner>}
              {isError && (
                <ErrorBanner>
                  We could not load your current photo.{" "}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void refetch()}
                  >
                    Try again
                  </button>
                </ErrorBanner>
              )}
              <input
                ref={input}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="Choose profile photo"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void change(file);
                }}
              />
              <button
                className="photo-option"
                type="button"
                disabled={busy || isPending || isError}
                onClick={() => input.current?.click()}
              >
                <span className="photo-option-icon">
                  <i className="ti ti-photo" aria-hidden />
                </span>
                <span>
                  <strong>
                    {busy ? "Updating photo…" : "Upload a new image"}
                  </strong>
                  <small>PNG, JPG or WebP · Up to 5 MB</small>
                </span>
                <i className="ti ti-chevron-right" aria-hidden />
              </button>
              <button
                className="photo-option photo-option-remove"
                type="button"
                disabled={busy || !photoUrl || isPending || isError}
                onClick={() => void change()}
              >
                <span className="photo-option-icon">
                  <i className="ti ti-trash" aria-hidden />
                </span>
                <span>
                  <strong>Remove current image</strong>
                  <small>
                    {photoUrl
                      ? "Use your initials instead"
                      : "No profile photo to remove"}
                  </small>
                </span>
              </button>
              <div className="photo-dialog-footer">
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
