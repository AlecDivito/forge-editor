import { FaTimes } from "react-icons/fa";

interface TabProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
}

const Tab: React.FC<TabProps> = ({ label, isActive, onClick, onClose }) => {
  return (
    <div
      className={`flex items-center px-4 py-2 text-sm font-medium cursor-pointer border-b-2 ${
        isActive
          ? "border-blue-500 text-blue-500"
          : "border-transparent text-gray-600 hover:text-blue-500"
      }`}
      onClick={onClick}
    >
      <span className="mr-2">{label}</span>
      <FaTimes
        className="text-gray-400 hover:text-red-500"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
    </div>
  );
};

export default Tab;
