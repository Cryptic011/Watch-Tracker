import UIKit

final class WatchLogControls: UIView {
    var action: ((String) -> Void)?
    private let capsule = UIVisualEffectView(effect: UIBlurEffect(style: .systemThickMaterial))
    private let stack = UIStackView()
    private let library = UIButton(type: .system)
    private let settings = UIButton(type: .system)
    private let search = UIButton(type: .system)
    private let searchButton = UIButton(type: .system)
    private var dockWidth: NSLayoutConstraint!
    private var maximumWidth: NSLayoutConstraint!

    override init(frame: CGRect) {
        super.init(frame: frame)
        accessibilityIdentifier = "native-bottom-controls"
        capsule.translatesAutoresizingMaskIntoConstraints = false
        capsule.layer.cornerRadius = 33; capsule.clipsToBounds = true
        capsule.layer.borderWidth = 1
        addSubview(capsule)
        stack.axis = .horizontal; stack.distribution = .fillEqually
        stack.translatesAutoresizingMaskIntoConstraints = false
        capsule.contentView.addSubview(stack)
        configure(library, title: "Library", symbol: "square.on.square", action: "library")
        configure(settings, title: "Settings", symbol: "gearshape.fill", action: "settings")
        configure(search, title: "Search", symbol: "magnifyingglass", action: "search")
        search.isHidden = true
        stack.addArrangedSubview(library); stack.addArrangedSubview(search); stack.addArrangedSubview(settings)
        searchButton.translatesAutoresizingMaskIntoConstraints = false
        searchButton.accessibilityIdentifier = "native-search-button"
        searchButton.accessibilityLabel = "Search titles"
        searchButton.setImage(UIImage(systemName: "magnifyingglass", withConfiguration: UIImage.SymbolConfiguration(pointSize: 25, weight: .semibold)), for: .normal)
        searchButton.layer.cornerRadius = 26; searchButton.layer.borderWidth = 1
        searchButton.addAction(UIAction { [weak self] _ in self?.action?("search") }, for: .touchUpInside)
        addSubview(searchButton)
        dockWidth = capsule.widthAnchor.constraint(equalTo: widthAnchor, constant: -152)
        dockWidth.priority = .defaultHigh
        maximumWidth = capsule.widthAnchor.constraint(lessThanOrEqualToConstant: 252)
        NSLayoutConstraint.activate([
            capsule.centerXAnchor.constraint(equalTo: centerXAnchor),
            capsule.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12),
            capsule.heightAnchor.constraint(equalToConstant: 66),
            maximumWidth, dockWidth,
            stack.leadingAnchor.constraint(equalTo: capsule.contentView.leadingAnchor, constant: 6),
            stack.trailingAnchor.constraint(equalTo: capsule.contentView.trailingAnchor, constant: -6),
            stack.topAnchor.constraint(equalTo: capsule.contentView.topAnchor, constant: 6),
            stack.bottomAnchor.constraint(equalTo: capsule.contentView.bottomAnchor, constant: -6),
            searchButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
            searchButton.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -19),
            searchButton.widthAnchor.constraint(equalToConstant: 52), searchButton.heightAnchor.constraint(equalToConstant: 52)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func configure(_ button: UIButton, title: String, symbol: String, action name: String) {
        var config = UIButton.Configuration.plain()
        config.title = title
        config.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 23, weight: .medium))
        config.imagePlacement = .top; config.imagePadding = 3
        config.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 4, bottom: 4, trailing: 4)
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
            var result = attributes; result.font = UIFont.systemFont(ofSize: 11, weight: .semibold); return result
        }
        button.configuration = config
        button.layer.cornerRadius = 27
        button.accessibilityIdentifier = "native-" + name
        button.accessibilityLabel = title
        button.addAction(UIAction { [weak self] _ in self?.action?(name) }, for: .touchUpInside)
    }

    func update(tab: String, searchVisible: Bool, dark: Bool) {
        overrideUserInterfaceStyle = dark ? .dark : .light
        let foreground: UIColor = dark ? .white : .black
        capsule.layer.borderColor = foreground.withAlphaComponent(0.12).cgColor
        let searching = tab == "search"
        search.isHidden = !searching
        dockWidth.constant = searching ? -48 : -152
        maximumWidth.constant = searching ? 300 : 252
        for (button, name) in [(library, "library"), (search, "search"), (settings, "settings")] {
            let selected = tab == name
            button.configuration?.baseForegroundColor = selected ? foreground : .secondaryLabel
            button.backgroundColor = selected ? (dark ? .black : .white) : .clear
            button.accessibilityTraits = selected ? [.button, .selected] : [.button]
        }
        searchButton.isHidden = !searchVisible || searching
        searchButton.tintColor = foreground
        searchButton.backgroundColor = dark ? UIColor(white: 0.1, alpha: 1) : .white
        searchButton.layer.borderColor = foreground.withAlphaComponent(0.14).cgColor
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        // Transparent space around the dock continues to scroll the page.
        return hit === self ? nil : hit
    }
}
