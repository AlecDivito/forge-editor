import { FC, useState } from "react";

export interface FileName {
  name: string;
}

interface Props {
  onCreate?: (body: FileName) => void;
}

const CreateFileForm: FC<Props> = ({ onCreate }) => {
  const [state, setState] = useState("");

  return (
    <div className="p-2 ">
      <input
        type="text"
        value={state}
        onChange={(e) => setState(e.target.value)}
        placeholder="Enter file name"
        className="p-2 border rounded w-full text-black"
      />
      <button
        onClick={() => {
          onCreate?.({ name: state });
          setState("");
        }}
        className="mt-2 px-4 py-2 bg-blue-500 text-white rounded"
      >
        Create File
      </button>
    </div>
  );
};

export default CreateFileForm;
