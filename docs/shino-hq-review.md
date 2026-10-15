# HQ v0.1 independent review and corrections

An independent read-only reviewer inspected `f234578..dad6eda`, reran the model/UI suites, and reproduced four important defects using synthetic in-memory fixtures. No live personal data, port 4177, deployment or other repository was accessed.

| Finding | Delivered correction | Regression evidence |
| --- | --- | --- |
| Restore could reuse revisions from an earlier timeline and accept a stale form. | Stable HQ generation is carried by mutations and rotated by every restore; entity IDs and restored content stay stable. | Former-generation and equal-revision ABA mutations are rejected, including over HTTP and after restart. |
| A valid exported HQ could exceed the UI/HTTP restore limits. | Accepted HQ is bounded to 6 MB of UTF-8 JSON and downloads use compact JSON, leaving envelope headroom under the 7.5 MB import/8M HTTP bounds. | Multibyte bulk fixtures reach capacity, export, and restore successfully; oversized mutation is rejected. |
| A mutation could append beyond a schema limit and persist an unreadable state. | Mutations operate on a detached HQ candidate; resulting schema/capacity is checked before replacing any live collection. | Rejected capacity writes leave state unchanged and readable/exportable. |
| A rejected array-valued derived identifier could be interpolated into public evidence IDs. | Only validated scalar project IDs enter derived projection or public identifier construction. | Array/nested-array canaries are absent from fresh projection, coverage fallback, build logs and all distributed files. |

A fifth finding concerned a CONTROL behavior regression: refreshing after ignoring a discovered source reset the active view to the radar. Routing now preserves the current CONTROL subview on data refresh and follows hash changes explicitly. The route regression test passes.

The new regression tests were observed failing before the corresponding fixes, then passed with the full CONTROL/HQ suite and public build. No review finding is deferred. This is implementation verification, not owner acceptance or deployment authorization.

Review exclusions remain explicit: live owner workflow, physical device behavior, deployment, pre-existing CONTROL URL rendering and unsupported multiple-process state writers. Backup SHA-256 checks detect corruption and do not authenticate the author. Exact-head CI is reported in the Draft PR checks and delivery response.
