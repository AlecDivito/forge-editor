import { GitChange } from "@/lib/generated";
import { GitChangeView } from "./models/git-view.model";
import GitChangeRow from "./GitChangeRow";

interface Props {
  changes: GitChange[];
  view: GitChangeView;
}

export default function GitChangeList(props: Props) {
  return props.changes.map((change) => (
    <GitChangeRow key={`${props.view}:${change.path}`} change={change} view={props.view} />
  ));
}
